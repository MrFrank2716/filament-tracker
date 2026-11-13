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

/**
 * Fire and forget: a mail server that is down must never fail the change that triggered the email.
 * Without SMTP settings the message is printed, so the flow can be followed in development.
 */
export function sendMail(mail: Mail): void {
  const smtp = transporter();
  if (!smtp) {
    console.log(`[mail] (SMTP_URL not set, not sent) To: ${mail.to}\nSubject: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  smtp.sendMail({ from: env.MAIL_FROM, ...mail }).catch((error: unknown) => {
    console.error(`[mail] Could not send "${mail.subject}" to ${mail.to}:`, error instanceof Error ? error.message : error);
  });
}
