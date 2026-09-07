import { vi } from 'vitest';

// Only the subprocess configuration loads this fault injection.
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    symlink: async () => {
      throw Object.assign(new Error('Injected symlink creation failure'), {
        code: process.env.SDOC_TEST_SYMLINK_ERROR,
      });
    },
  };
});
