import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';

/**
 * The few calls backups need from S3-compatible storage (Cloudflare R2, Backblaze B2, MinIO, Amazon S3):
 * put, get, list and delete, signed with AWS Signature Version 4. Written on Node's own modules so a backup
 * does not hang on a large dependency.
 *
 * Addresses are path-style (`<endpoint>/<bucket>/<key>`), which every one of those services accepts.
 */
export interface BucketConfig {
  /** For example `https://<account>.r2.cloudflarestorage.com`. No bucket name, no trailing path. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface StoredObject {
  key: string;
  size: number;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986: everything but letters, digits and `-._~` is percent-encoded. encodeURIComponent leaves `!*'()` alone. */
const encode = (value: string) => encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign besides host, x-amz-date and x-amz-content-sha256. */
  headers?: Record<string, string>;
  payloadHash: string;
  now?: Date;
}

/** The headers to send, including Authorization. `url.pathname` must already be encoded as it will be sent. */
export function signRequest(config: Pick<BucketConfig, 'region' | 'accessKeyId' | 'secretAccessKey'>, input: SignInput): Record<string, string> {
  const stamp = (input.now ?? new Date()).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value.trim()])),
    host: input.url.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': stamp,
  };
  const names = Object.keys(headers).sort();
  const query = [...input.url.searchParams.entries()]
    .map(([name, value]) => [encode(name), encode(value)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const canonical = [
    input.method,
    input.url.pathname,
    query,
    ...names.map((name) => `${name}:${headers[name]}`),
    '',
    names.join(';'),
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

const EMPTY_HASH = sha256('');
const TIMEOUT_MS = 5 * 60 * 1000;

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

const decodeXml = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (_all, name: string, dec?: string, hex?: string) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name] ?? '';
  });

const tag = (xml: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];

export class BucketError extends Error {}

export function openBucket(config: BucketConfig) {
  const base = config.endpoint.replace(/\/+$/, '');
  const address = (key: string, query: Record<string, string> = {}) => {
    const url = new URL(`${base}/${encode(config.bucket)}${key ? `/${key.split('/').map(encode).join('/')}` : ''}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url;
  };

  /** One signed request. `file` is streamed as the body; the answer is streamed into `into` or returned as text. */
  function send(method: string, url: URL, options: { file?: { path: string; size: number; hash: string }; into?: string } = {}): Promise<string> {
    const payloadHash = options.file?.hash ?? EMPTY_HASH;
    const headers = signRequest(config, { method, url, payloadHash });
    if (options.file) headers['content-length'] = String(options.file.size);
    // The query is sent exactly as it was signed: URL would write a space as "+", which S3 reads as a plus sign.
    const query = [...url.searchParams.entries()].map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
    const transport = url.protocol === 'http:' ? http : https;
    return new Promise<string>((resolve, reject) => {
      const request = transport.request(
        { method, protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${query ? `?${query}` : ''}`, headers, timeout: TIMEOUT_MS },
        (response) => {
          const ok = (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300;
          if (ok && options.into) {
            pipeline(response, createWriteStream(options.into)).then(() => resolve(''), reject);
            return;
          }
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (ok) resolve(text);
            else reject(new BucketError(`${method} ${url.pathname} answered ${response.statusCode}: ${tag(text, 'Message') ?? text.slice(0, 300)}`));
          });
        },
      );
      request.on('timeout', () => request.destroy(new BucketError(`${method} ${url.pathname} timed out`)));
      request.on('error', reject);
      if (options.file) pipeline(createReadStream(options.file.path), request).catch(reject);
      else request.end();
    });
  }

  return {
    async putFile(key: string, file: string): Promise<void> {
      const [{ size }, hash] = await Promise.all([stat(file), hashFile(file)]);
      await send('PUT', address(key), { file: { path: file, size, hash } });
    },
    async getFile(key: string, into: string): Promise<void> {
      await send('GET', address(key), { into });
    },
    async remove(key: string): Promise<void> {
      await send('DELETE', address(key));
    },
    /** Every object whose key starts with `prefix`, however many pages that takes. */
    async list(prefix: string): Promise<StoredObject[]> {
      const found: StoredObject[] = [];
      let token: string | undefined;
      do {
        const xml = await send('GET', address('', { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) }));
        for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = tag(entry, 'Key');
          if (key !== undefined) found.push({ key: decodeXml(key), size: Number(tag(entry, 'Size') ?? 0) });
        }
        const next = tag(xml, 'NextContinuationToken');
        token = tag(xml, 'IsTruncated') === 'true' && next ? decodeXml(next) : undefined;
      } while (token);
      return found;
    },
  };
}

export type Bucket = ReturnType<typeof openBucket>;
