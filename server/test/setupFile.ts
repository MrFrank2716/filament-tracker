import { randomBytes } from 'node:crypto';
import { copyFileSync } from 'node:fs';
import path from 'node:path';

// Runs before a test file's own imports, so the database client it creates points at this file's private copy.
const file = path.join(process.env.TEST_DB_DIR!, `${randomBytes(6).toString('hex')}.db`);
copyFileSync(process.env.TEST_DB_TEMPLATE!, file);
process.env.DATABASE_URL = `file:${file}`;
