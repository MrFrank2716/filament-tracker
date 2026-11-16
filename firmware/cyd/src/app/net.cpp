#include "net.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <string.h>
#include <time.h>

#include "certs.h"

#ifndef WB_VERSION
#define WB_VERSION "dev"
#endif
#ifndef WB_PANEL
#define WB_PANEL "unknown"
#endif

namespace net {
namespace {

store::Settings settings;
bool readerPresent = false;
QueueHandle_t commands;
QueueHandle_t results;
SemaphoreHandle_t lock;
Status shared;

// Only the network task uses these.
char response[wb::MAX_RESPONSE + 1];
size_t responseLen = 0;
char lastV[24] = "";
char browsing[32] = "";
uint32_t pollMs = 30000;
unsigned failures = 0;
bool timeSynced = false;

void setStatus(Phase phase, const char *message = nullptr, bool ok = false) {
  xSemaphoreTake(lock, portMAX_DELAY);
  shared.phase = phase;
  if (message) wb::copyText(shared.message, sizeof shared.message, message);
  if (ok) {
    shared.lastOkMs = millis();
    shared.message[0] = '\0';
  }
  shared.rssi = WiFi.RSSI();
  wb::copyText(shared.ip, sizeof shared.ip, WiFi.localIP().toString().c_str());
  xSemaphoreGive(lock);
}

Phase currentPhase() {
  xSemaphoreTake(lock, portMAX_DELAY);
  const Phase phase = shared.phase;
  xSemaphoreGive(lock);
  return phase;
}

void post(ResultType type, bool ok, const char *message, void *data = nullptr) {
  Result result{};
  result.type = type;
  result.ok = ok;
  wb::copyText(result.message, sizeof result.message, message ? message : "");
  result.data = data;
  if (xQueueSend(results, &result, pdMS_TO_TICKS(1000)) != pdTRUE) free(data);
}

/** Certificates can only be checked once the clock is right, so https waits for the time. */
bool ensureTime() {
  if (timeSynced || !wb::isHttps(settings.url) || settings.insecure) return true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  for (int i = 0; i < 40; i++) {
    if (time(nullptr) > 1700000000) {
      timeSynced = true;
      return true;
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
  return false;
}

/**
 * One request. Returns the HTTP status (negative for a network error) with the body in `response`.
 * HTTP/1.0 so the body never arrives chunked, and a size cap so a surprise cannot run the board out of memory.
 */
int request(const char *method, const char *path, const char *body = nullptr) {
  responseLen = 0;
  response[0] = '\0';
  if (!ensureTime()) return -100;
  static WiFiClient plain;
  static WiFiClientSecure secure;
  const bool https = wb::isHttps(settings.url);
  if (https) {
    if (settings.insecure) secure.setInsecure();
    else secure.setCACert(WB_ROOT_CERTS);
  }
  String url = String(settings.url) + path;
  HTTPClient http;
  http.useHTTP10(true);
  http.setTimeout(10000);
  http.setConnectTimeout(8000);
  if (!(https ? http.begin(secure, url) : http.begin(plain, url))) return -101;
  if (settings.token[0]) http.addHeader("Authorization", String("Bearer ") + settings.token);
  http.addHeader("Accept", "application/json");
  int status;
  if (body) {
    http.addHeader("Content-Type", "application/json");
    status = http.sendRequest(method, reinterpret_cast<uint8_t *>(const_cast<char *>(body)), strlen(body));
  } else {
    status = http.sendRequest(method);
  }
  if (status > 0) {
    const int size = http.getSize();
    if (size > static_cast<int>(wb::MAX_RESPONSE)) {
      http.end();
      return -102;
    }
    WiFiClient *stream = http.getStreamPtr();
    const uint32_t started = millis();
    while ((size < 0 || responseLen < static_cast<size_t>(size)) && responseLen < wb::MAX_RESPONSE && millis() - started < 10000) {
      const int available = stream->available();
      if (available > 0) {
        responseLen += stream->readBytes(response + responseLen, min(static_cast<size_t>(available), wb::MAX_RESPONSE - responseLen));
      } else if (!stream->connected()) {
        break;
      } else {
        vTaskDelay(pdMS_TO_TICKS(5));
      }
    }
    response[responseLen] = '\0';
  }
  http.end();
  return status;
}

const char *describeFailure(int status) {
  switch (status) {
    case -100: return "Could not get the time for a secure connection";
    case -102: return "The server's answer was too big";
    case HTTPC_ERROR_CONNECTION_REFUSED: return "Server refused the connection";
    case HTTPC_ERROR_READ_TIMEOUT: return "Server took too long";
    default: break;
  }
  if (status >= 500) return "Server error";
  if (status == 404) return "Wrong address, or displays are off";
  if (status == 429) return "Too many requests, waiting";
  if (status > 0) return "Unexpected answer";
  return wb::isHttps(settings.url) ? "Cannot reach the server (check the address or certificate)" : "Cannot reach the server";
}

/** The token is gone or no longer works: back to asking for a set-up code. */
void unauthorized() {
  settings.token[0] = '\0';
  store::clearToken();
  lastV[0] = '\0';
  setStatus(Phase::NeedCode, "This display needs a new set-up code");
  post(ResultType::Unauthorized, false, "This display needs a new set-up code");
}

void pair(const char *code) {
  setStatus(Phase::Pairing);
  char body[200];
  snprintf(body, sizeof body, "{\"code\":\"%s\",\"model\":\"cyd-28-%s%s\",\"version\":\"%s\"}", code, WB_PANEL, readerPresent ? "+pn532" : "", WB_VERSION);
  settings.token[0] = '\0';
  const int status = request("POST", "/api/device/pair", body);
  if (status <= 0 || status >= 500 || status == 429) {
    // The server was not reached, so the code is still good: try it again shortly.
    wb::copyText(settings.code, sizeof settings.code, code);
    failures++;
    setStatus(Phase::Pairing, describeFailure(status));
    vTaskDelay(pdMS_TO_TICKS(wb::backoffMs(failures)));
    return;
  }
  // The server answered: the code is used up or was wrong. Never send it twice.
  settings.code[0] = '\0';
  if (status == 200) {
    static wb::PairResult paired;
    if (wb::parsePair(response, responseLen, paired)) {
      wb::copyText(settings.token, sizeof settings.token, paired.token);
      store::save(settings);
      failures = 0;
      setStatus(Phase::Online, nullptr, true);
      post(ResultType::Paired, true, paired.deviceName);
      return;
    }
  }
  store::save(settings);
  char message[96];
  if (status > 0) wb::parseMessage(response, responseLen, message, sizeof message);
  else wb::copyText(message, sizeof message, describeFailure(status));
  if (!message[0]) wb::copyText(message, sizeof message, describeFailure(status));
  setStatus(Phase::NeedCode, message);
  post(ResultType::PairFailed, false, message);
}

void poll() {
  char path[160];
  snprintf(path, sizeof path, "/api/device/overview?nfc=%d%s%s%s%s", readerPresent ? 1 : 0, lastV[0] ? "&since=" : "", lastV, browsing[0] ? "&location=" : "", browsing);
  const int status = request("GET", path);
  if (status == 304) {
    failures = 0;
    setStatus(Phase::Online, nullptr, true);
    return;
  }
  if (status == 401) return unauthorized();
  if (status == 404 && browsing[0]) {
    // The location being browsed was deleted: back to the display's own.
    browsing[0] = '\0';
    lastV[0] = '\0';
    return poll();
  }
  if (status == 200) {
    auto *overview = static_cast<wb::Overview *>(malloc(sizeof(wb::Overview)));
    if (overview && wb::parseOverview(response, responseLen, *overview)) {
      wb::copyText(lastV, sizeof lastV, overview->v);
      pollMs = static_cast<uint32_t>(overview->poll) * 1000;
      failures = 0;
      setStatus(Phase::Online, nullptr, true);
      post(ResultType::Overview, true, "", overview);
      return;
    }
    free(overview);
  }
  failures++;
  setStatus(Phase::Offline, describeFailure(status));
}

/** A tag call: GET for a lookup, POST for the changes. */
void tagCall(const Command &command) {
  char path[96];
  const char *suffix = command.type == CommandType::PutAway ? "/put-away" : command.type == CommandType::Insert ? "/insert" : command.type == CommandType::Link ? "/link" : "";
  snprintf(path, sizeof path, "/api/device/tag/%s%s", command.arg, suffix);
  char body[64];
  if (command.type == CommandType::Link) snprintf(body, sizeof body, "{\"itemId\":\"%s\"}", command.arg2);
  const int status = command.type == CommandType::Tag ? request("GET", path) : request("POST", path, command.type == CommandType::Link ? body : "{}");
  if (status == 401) return unauthorized();
  if (command.type == CommandType::Tag) {
    auto *info = static_cast<wb::TagInfo *>(malloc(sizeof(wb::TagInfo)));
    if (status == 200 && info && wb::parseTag(response, responseLen, *info)) {
      post(ResultType::Tag, true, "", info);
      return;
    }
    free(info);
    char message[96];
    wb::parseMessage(response, responseLen, message, sizeof message);
    post(ResultType::Tag, false, message[0] ? message : describeFailure(status));
    return;
  }
  char message[96];
  wb::parseMessage(response, responseLen, message, sizeof message);
  if (!message[0]) wb::copyText(message, sizeof message, status == 200 ? "Done" : describeFailure(status));
  post(ResultType::Action, status == 200, message);
  if (status == 200) lastV[0] = '\0';  // what is stored here may have changed
}

void untagged() {
  const int status = request("GET", "/api/device/untagged");
  if (status == 401) return unauthorized();
  auto *list = static_cast<wb::ItemList *>(malloc(sizeof(wb::ItemList)));
  if (status == 200 && list && wb::parseItemList(response, responseLen, *list)) {
    post(ResultType::Untagged, true, "", list);
    return;
  }
  free(list);
  post(ResultType::Untagged, false, describeFailure(status));
}

void task(void *) {
  uint32_t nextPoll = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      if (currentPhase() != Phase::NeedCode) setStatus(Phase::Connecting);
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (!settings.token[0]) {
      if (settings.code[0]) {
        pair(settings.code);
        nextPoll = 0;
        continue;
      }
      if (currentPhase() != Phase::NeedCode) setStatus(Phase::NeedCode, "Enter a set-up code");
    }

    // Commands first; wait for one until the next poll is due.
    const uint32_t now = millis();
    const uint32_t wait = settings.token[0] && nextPoll > now ? nextPoll - now : (settings.token[0] ? 0 : 1000);
    Command command;
    if (xQueueReceive(commands, &command, pdMS_TO_TICKS(wait)) == pdTRUE) {
      switch (command.type) {
        case CommandType::Pair: pair(command.arg); nextPoll = 0; break;
        case CommandType::Browse:
          wb::copyText(browsing, sizeof browsing, command.arg);
          lastV[0] = '\0';
          nextPoll = 0;
          break;
        case CommandType::Refresh: lastV[0] = '\0'; nextPoll = 0; break;
        case CommandType::Untagged: if (settings.token[0]) untagged(); break;
        case CommandType::Forget:
          settings.token[0] = '\0';
          settings.code[0] = '\0';
          store::save(settings);
          lastV[0] = '\0';
          browsing[0] = '\0';
          setStatus(Phase::NeedCode, "Enter a set-up code");
          break;
        default: if (settings.token[0]) tagCall(command); nextPoll = millis() + 1500; break;
      }
      continue;
    }
    if (!settings.token[0]) continue;
    poll();
    nextPoll = millis() + (failures ? wb::backoffMs(failures) : pollMs);
  }
}

}  // namespace

void start(const store::Settings &initial, bool hasReader) {
  settings = initial;
  readerPresent = hasReader;
  lock = xSemaphoreCreateMutex();
  commands = xQueueCreate(6, sizeof(Command));
  results = xQueueCreate(6, sizeof(Result));
  shared = Status{};
  shared.phase = Phase::Connecting;
  // Core 0 with Wi-Fi; the screen runs on core 1. TLS needs a deep stack.
  xTaskCreatePinnedToCore(task, "wb-net", 12288, nullptr, 1, nullptr, 0);
}

void send(const Command &command) { xQueueSend(commands, &command, 0); }

bool receive(Result &out) { return results && xQueueReceive(results, &out, 0) == pdTRUE; }

Status status() {
  if (!lock) return Status{};
  xSemaphoreTake(lock, portMAX_DELAY);
  Status copy = shared;
  xSemaphoreGive(lock);
  return copy;
}

}  // namespace net
