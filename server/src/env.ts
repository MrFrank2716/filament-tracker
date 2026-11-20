import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // How many proxies sit in front of the app (1 on most hosts, 0 when it is reached directly).
  // Rate limits count per client address, which is only right when this matches.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // Files sent with outside job requests. The folder is relative to the server package unless absolute.
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(2048).default(50),
  UPLOAD_MAX_FILES: z.coerce.number().int().positive().max(50).default(5),
  // Emails: password reset links, and status updates to people who sent a job request.
  // RESEND_API_KEY sends over HTTPS, which works on hosts that block outgoing SMTP (it wins when both are set).
  // SMTP_URL is the alternative, e.g. smtps://user:pass@smtp.example.com:465. With neither, emails are printed to the log.
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Wrkbench <no-reply@localhost>'),
  // Whether a new account must open a link sent to its address before it can be added to someone else's workspace.
  // "auto" asks for it when email can actually be sent (RESEND_API_KEY or SMTP_URL), and not otherwise.
  EMAIL_CONFIRMATION: z.enum(['auto', 'on', 'off']).default('auto'),
  // Where the app is reached, for links in emails. Defaults to CLIENT_ORIGIN.
  APP_URL: z.string().optional(),
  // Connected printers. PRINTERS_ENABLED=false hides the feature and refuses bridges.
  PRINTERS_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  BRIDGE_MAX_PER_WORKSPACE: z.coerce.number().int().min(0).max(50).default(3),
  PRINTER_MAX_PER_BRIDGE: z.coerce.number().int().min(1).max(64).default(20),
  // The container image named in the set-up command shown to admins.
  BRIDGE_IMAGE: z.string().default('ghcr.io/hussxin5046/wrkbench-bridge:latest'),
  // Location displays: small screens on shelves that show what is stored there. DEVICES_ENABLED=false refuses them.
  DEVICES_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  DEVICE_MAX_PER_WORKSPACE: z.coerce.number().int().min(0).max(100).default(5),
  UPLOAD_EXTENSIONS: z.string().default('3mf,stl,step,stp,obj,amf,gcode,nc,svg,dxf,pdf,png,jpg,jpeg,txt'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment. Copy server/.env.example to server/.env and fill it in, or set these on your host.');
  console.error(parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const env = parsed.data;
