import { readFile, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

export class ContainedFileError extends Error {
  constructor(
    public readonly code: 'UNSAFE_PATH' | 'WRONG_EXTENSION' | 'NOT_A_FILE' | 'FILE_TOO_LARGE',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ContainedFileError';
  }
}

const isContained = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== ''
    && !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`);
};

export async function resolveContainedRegularFile(
  rootPath: string,
  candidatePath: string,
  options: { extension: string; maximumBytes: number },
): Promise<{ canonicalPath: string; size: number }> {
  if (!candidatePath || path.isAbsolute(candidatePath)) {
    throw new ContainedFileError('UNSAFE_PATH', 'The path must be relative to the approved root.');
  }
  const normalizedExtension = options.extension.toLowerCase();
  if (path.extname(candidatePath).toLowerCase() !== normalizedExtension) {
    throw new ContainedFileError('WRONG_EXTENSION', `The file must use the ${normalizedExtension} extension.`);
  }

  const canonicalRoot = await realpath(path.resolve(rootPath));
  const lexicalTarget = path.resolve(canonicalRoot, candidatePath);
  if (!isContained(canonicalRoot, lexicalTarget)) {
    throw new ContainedFileError('UNSAFE_PATH', 'The path resolves outside the approved root.');
  }

  const canonicalPath = await realpath(lexicalTarget);
  if (!isContained(canonicalRoot, canonicalPath)) {
    throw new ContainedFileError('UNSAFE_PATH', 'The file resolves outside the approved root.');
  }
  const fileStat = await stat(canonicalPath);
  if (!fileStat.isFile()) {
    throw new ContainedFileError('NOT_A_FILE', 'The selected path is not a regular file.');
  }
  if (fileStat.size > options.maximumBytes) {
    throw new ContainedFileError(
      'FILE_TOO_LARGE',
      `The file exceeds ${options.maximumBytes} bytes.`,
    );
  }
  return { canonicalPath, size: fileStat.size };
}

export async function readContainedTextFile(
  rootPath: string,
  candidatePath: string,
  options: { extension: string; maximumBytes: number },
): Promise<string> {
  const resolved = await resolveContainedRegularFile(rootPath, candidatePath, options);
  const bytes = await readFile(resolved.canonicalPath);
  if (bytes.byteLength > options.maximumBytes) {
    throw new ContainedFileError(
      'FILE_TOO_LARGE',
      `The file exceeds ${options.maximumBytes} bytes.`,
    );
  }
  return bytes.toString('utf8');
}
