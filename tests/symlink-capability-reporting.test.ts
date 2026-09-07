import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('file symlink test reporting', () => {
  it.each([
    { code: 'EPERM', required: false, skipped: true },
    { code: 'EACCES', required: false, skipped: true },
    { code: 'ENOSYS', required: false, skipped: true },
    { code: 'ENOTSUP', required: false, skipped: true },
    { code: 'EPERM', required: true, skipped: false },
    { code: 'ENOENT', required: false, skipped: false },
    { code: 'EIO', required: false, skipped: false },
  ])('$code with required=$required reports skipped=$skipped', ({ code, required, skipped }) => {
    const result = spawnSync(process.execPath, [
      'node_modules/vitest/vitest.mjs', 'run',
      '--config', 'tests/fixtures/symlink-capability/vitest.config.mts',
      '--reporter=json', '--maxWorkers=1', '--disableConsoleIntercept',
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        SDOC_TEST_SYMLINK_ERROR: code,
        SDOC_REQUIRE_FILE_SYMLINK: required ? '1' : '0',
        NO_COLOR: '1',
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(skipped ? 0 : 1);
    const report: unknown = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      numTotalTests: 3,
      numPassedTests: 2,
      numPendingTests: skipped ? 1 : 0,
      numFailedTests: skipped ? 0 : 1,
      testResults: [{
        assertionResults: expect.arrayContaining([
          expect.objectContaining({
            title: 'rejects a symlink that escapes the approved root',
            status: skipped ? 'skipped' : 'failed',
            failureMessages: skipped ? [] : [
              expect.stringContaining('Injected symlink creation failure'),
            ],
          }),
        ]),
      }],
    });
    if (skipped) {
      expect(result.stderr).toContain(`File symlink unavailable (${code})`);
    }
  }, 35_000);
});
