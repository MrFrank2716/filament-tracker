import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'test/**/*.test.ts'],
    // Each test file gets its own process, and so its own copy of every module and (through test/setupFile.ts)
    // its own database file with every migration applied.
    pool: 'forks',
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setupFile.ts'],
    // Satisfies env.ts when a test imports server code. DATABASE_URL is replaced per file by test/setupFile.ts.
    env: { DATABASE_URL: 'file:./unused-by-tests.db', JWT_SECRET: 'test-only-secret-not-used-outside-vitest-0123456789' },
    testTimeout: 20_000,
  },
});
