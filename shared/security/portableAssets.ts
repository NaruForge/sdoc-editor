export const PORTABLE_ASSET_DIRECTORIES = ['images', 'drawio'] as const;

export type PortableAssetDirectory = typeof PORTABLE_ASSET_DIRECTORIES[number];

export interface PortableAssetPath {
  directory: PortableAssetDirectory;
  segments: string[];
  fileName: string;
  path: string;
}

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORBIDDEN_NAME_CHARACTER = /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/;
const MAX_PORTABLE_NAME_LENGTH = 240;
const IMAGE_EXTENSION_ALIASES: Readonly<Record<string, string>> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpeg',
  gif: 'gif',
  svg: 'svg',
  'svg+xml': 'svg',
  webp: 'webp',
  bmp: 'bmp',
  ico: 'ico',
  'x-icon': 'ico',
};

function parsePortableName(value: string): string | undefined {
  const normalized = value.normalize('NFC');
  if (!normalized || normalized.length > MAX_PORTABLE_NAME_LENGTH) return undefined;
  if (normalized !== normalized.trim() || normalized.startsWith('.') || /[. ]$/.test(normalized)) {
    return undefined;
  }
  if (normalized.includes('..') || FORBIDDEN_NAME_CHARACTER.test(normalized)) return undefined;
  if (WINDOWS_RESERVED_NAME.test(normalized)) return undefined;
  return normalized;
}

/** Validate a user-supplied filename stem. The value is rejected, never silently sanitized. */
export function parseAssetStem(value: unknown): string | undefined {
  return typeof value === 'string' ? parsePortableName(value) : undefined;
}

/** Validate one portable path segment or imported filename. */
export function parseAssetFileName(value: unknown): string | undefined {
  return typeof value === 'string' ? parsePortableName(value) : undefined;
}

export function parseImageExtension(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return IMAGE_EXTENSION_ALIASES[value.trim().toLowerCase()];
}

/**
 * Parse an asset path that must stay below a caller-owned root. Both `./a/b.png`
 * and `a/b.png` are accepted; absolute paths, URLs, backslashes and dot segments are not.
 */
export function parseContainedRelativeAssetPath(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('?') || value.includes('#')) {
    return undefined;
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) return undefined;

  const relative = value.startsWith('./') ? value.slice(2) : value;
  const rawSegments = relative.split('/');
  if (rawSegments.length === 0 || rawSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return undefined;
  }

  const segments = rawSegments.map(parsePortableName);
  return segments.every((segment): segment is string => Boolean(segment)) ? segments : undefined;
}

export function parsePortableAssetPath(
  value: unknown,
  expectedDirectory?: PortableAssetDirectory,
): PortableAssetPath | undefined {
  if (typeof value !== 'string' || !value.startsWith('./')) return undefined;
  const segments = parseContainedRelativeAssetPath(value);
  if (!segments || segments.length < 2) return undefined;

  const [directory, ...assetSegments] = segments;
  if (directory !== 'images' && directory !== 'drawio') return undefined;
  if (expectedDirectory && directory !== expectedDirectory) return undefined;

  return {
    directory,
    segments: assetSegments,
    fileName: assetSegments[assetSegments.length - 1],
    path: `./${directory}/${assetSegments.join('/')}`,
  };
}

export function buildPortableAssetPath(
  directory: PortableAssetDirectory,
  fileName: string,
): string {
  const safeName = parseAssetFileName(fileName);
  if (!safeName) throw new Error('Asset filename is not portable.');
  return `./${directory}/${safeName}`;
}

function appendCollisionSuffix(fileName: string, counter: number): string {
  const drawioSuffix = '.drawio.svg';
  if (fileName.toLowerCase().endsWith(drawioSuffix)) {
    return `${fileName.slice(0, -drawioSuffix.length)}-${counter}${drawioSuffix}`;
  }
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex > 0
    ? `${fileName.slice(0, extensionIndex)}-${counter}${fileName.slice(extensionIndex)}`
    : `${fileName}-${counter}`;
}

/**
 * Ask the backend to create candidates exclusively until one succeeds. The callback
 * must return false only when the candidate already exists and must not overwrite it.
 */
export async function chooseExclusiveAssetName(
  requestedFileName: string,
  createExclusive: (fileName: string) => Promise<boolean>,
  maxAttempts = 1_000,
): Promise<string> {
  const safeName = parseAssetFileName(requestedFileName);
  if (!safeName) throw new Error('Asset filename is not portable.');

  for (let counter = 0; counter < maxAttempts; counter += 1) {
    const candidate = counter === 0 ? safeName : appendCollisionSuffix(safeName, counter);
    if (await createExclusive(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a unique asset filename after ${maxAttempts} attempts.`);
}
