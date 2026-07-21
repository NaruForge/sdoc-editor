import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export async function withTemporaryDirectory<T>(
  prefix: string,
  task: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await task(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
