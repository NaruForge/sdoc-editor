import type { BookDiagnostic } from './types';

export const hasBookErrors = (diagnostics: readonly BookDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === 'error');

export function diagnosticsForDocument(
  diagnostics: readonly BookDiagnostic[],
  documentPath: string,
): BookDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.documentPath === documentPath);
}

