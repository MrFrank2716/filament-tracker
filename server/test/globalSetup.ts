import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Once per run: build an empty database with every migration applied. Each test file works on its own copy. */
export default function setup(): () => void {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrkbench-test-'));
  const template = path.join(dir, 'template.db');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: `file:${template}` }, stdio: 'pipe', shell: process.platform === 'win32' });
  process.env.TEST_DB_TEMPLATE = template;
  process.env.TEST_DB_DIR = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
