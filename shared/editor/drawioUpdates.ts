export function isUpdatedDrawioAsset(relativePath: unknown, updatedPath: string): boolean {
  return typeof relativePath === 'string' && relativePath === updatedPath;
}
