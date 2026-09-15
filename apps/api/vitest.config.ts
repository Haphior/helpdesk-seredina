import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    // Prisma's query engine doesn't play well with vitest's default worker_threads
    // pool (crashes with a raw IPC "Channel closed" error, no test output at all) --
    // process-forked workers avoid it.
    pool: 'forks',
  },
});
