import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/env';

let transport: Transporter | null = null;

function transporter(): Transporter | null {
  if (!env.SMTP_URL) return null;
  transport ??= nodemailer.createTransport(env.SMTP_URL);
  return transport;
}

export const appUrl = (path: string) => `${(env.APP_URL ?? env.CLIENT_ORIGIN).replace(/\/+$/, '')}${path}`;

interface Mail {
  to: string;
  subject: string;
  text: string;
}

const RESEND_ATTEMPTS = 3;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resend's HTTPS API. Used in preference to SMTP because some hosts block outgoing SMTP ports.
 * Only network errors, 429 and 5xx are retried, and every attempt carries the same idempotency key,
 * so a retry after a lost answer cannot deliver the email twice.
 */
async function sendViaResend(apiKey: string, mail: Mail): Promise<void> {
  const idempotencyKey = randomUUID();
  let failure = '';
  for (let attempt = 1; attempt <= RESEND_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await pause(1000 * 2 ** (attempt - 2));
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return;
      failure = `Resend answered ${response.status}: ${(await response.text()).slice(0, 300)}`;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(failure);
}

/**
 * Fire and forget: a mail server that is down must never fail the change that triggered the email.
 * Without mail settings the message is printed, so the flow can be followed in development.
 */
export function sendMail(mail: Mail): void {
  const failed = (error: unknown) => {
    console.error(`[mail] Could not send "${mail.subject}" to ${mail.to}:`, error instanceof Error ? error.message : error);
  };
  if (env.RESEND_API_KEY) {
    sendViaResend(env.RESEND_API_KEY, mail).catch(failed);
    return;
  }
  const smtp = transporter();
  if (!smtp) {
    console.log(`[mail] (no mail settings, not sent) To: ${mail.to}\nSubject: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  smtp.sendMail({ from: env.MAIL_FROM, ...mail }).catch(failed);
}

/** A message for whoever runs the server (ALERT_EMAIL). Without that setting it is only in the log, where the caller already put it. */
export function alertOperator(subject: string, lines: string[]): void {
  if (!env.ALERT_EMAIL) return;
  sendMail({ to: env.ALERT_EMAIL, subject, text: [...lines, '', `Sent by Wrkbench at ${appUrl('')}`].join('\n') });
}
