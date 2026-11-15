import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    // Each test file gets its own process, and so its own database file and its own copy of every module.
    pool: 'forks',
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setupFile.ts'],
    env: { JWT_SECRET: 'test-secret-that-is-long-enough', DATABASE_URL: 'file:./unused.db' },
    testTimeout: 20_000,
  },
});
