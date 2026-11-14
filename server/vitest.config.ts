import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Satisfies env.ts when a test imports server code. Tests that need a database open their own.
    env: { DATABASE_URL: 'file:./unused-by-tests.db', JWT_SECRET: 'test-only-secret-not-used-outside-vitest-0123456789' },
  },
});
