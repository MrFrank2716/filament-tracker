import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // Files sent with outside job requests. The folder is relative to the server package unless absolute.
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(2048).default(50),
  UPLOAD_MAX_FILES: z.coerce.number().int().positive().max(50).default(5),
  UPLOAD_EXTENSIONS: z.string().default('3mf,stl,step,stp,obj,amf,gcode,nc,svg,dxf,pdf,png,jpg,jpeg,txt'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment. Copy server/.env.example to server/.env and fill it in.');
  console.error(parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const env = parsed.data;
