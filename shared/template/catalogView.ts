import type {
  TemplateDiagnostic,
  TemplateDiagnosticCode,
  TemplateSource,
} from './types';
export type { TemplateDiagnosticCode, TemplateSource } from './types';

export interface TemplateCatalogDiagnosticView {
  id: string;
  code: TemplateDiagnosticCode;
  source: TemplateSource | 'catalog';
  severity: 'warning' | 'error';
  targetLabel: string;
  jsonPath?: string;
  detail?: string;
  recovery: 'retry' | 'fix-source' | 'resolve-duplicate' | 'none';
}

const WARNING_CODES = new Set<TemplateDiagnosticCode>([
  'legacy-document',
  'duplicate-template-id',
  'candidate-limit-exceeded',
  'unsupported-filesystem',
]);

const DIAGNOSTIC_DETAIL: Readonly<Record<TemplateDiagnosticCode, string>> = {
  'malformed-document': 'The file is not a valid .sdoc document.',
  'unsupported-version': 'The document version is not supported.',
  'legacy-document': 'The template must be upgraded to the current .sdoc format.',
  'invalid-template-metadata': 'The template metadata is incomplete or invalid.',
  'invalid-template-id': 'The personal template ID is invalid.',
  'duplicate-template-id': 'Another template uses the same ID.',
  'invalid-title-node': 'The configured title heading could not be found.',
  'unsupported-assets': 'The template contains assets that cannot be stored safely.',
  'read-failed': 'The template could not be read.',
  'unsafe-path': 'The template is outside the allowed template location.',
  'file-too-large': 'The template exceeds the allowed file size.',
  'candidate-limit-exceeded': 'Additional template files were skipped because the catalog limit was reached.',
  'unsupported-filesystem': 'This template location is not supported by the current host.',
};

const recoveryForCode = (
  code: TemplateDiagnosticCode,
): TemplateCatalogDiagnosticView['recovery'] => {
  if (code === 'read-failed') return 'retry';
  if (code === 'duplicate-template-id') return 'resolve-duplicate';
  if (code === 'candidate-limit-exceeded' || code === 'unsupported-filesystem') return 'none';
  return 'fix-source';
};

const fallbackTargetLabel = (
  source: TemplateCatalogDiagnosticView['source'],
): string => {
  if (source === 'builtin') return 'Built-in templates';
  if (source === 'workspace') return 'Workspace templates';
  if (source === 'user') return 'My templates';
  return 'Template catalog';
};

/**
 * Reduces a filesystem-bearing diagnostic target to a basename. The UI never
 * needs a host path to explain which candidate failed.
 */
export function sanitizeTemplateDiagnosticTarget(
  targetPath: string,
  source: TemplateCatalogDiagnosticView['source'],
): string {
  const normalized = targetPath.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  const basename = normalized.split('/').filter(Boolean).pop()?.trim();
  if (!basename || basename === '.' || basename === '..') {
    return fallbackTargetLabel(source);
  }
  return basename.slice(0, 120);
}

const stableDiagnosticId = (parts: readonly string[]): string => {
  let hash = 0x811c9dc5;
  const value = parts.join('\u001f');
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `template-diagnostic-${(hash >>> 0).toString(36)}`;
};

const safeJsonPath = (path: string | undefined): string | undefined => {
  if (!path?.startsWith('/')) return undefined;
  return path.slice(0, 200);
};

export function projectTemplateCatalogDiagnostic(
  diagnostic: TemplateDiagnostic,
  source: TemplateCatalogDiagnosticView['source'],
  occurrence = 0,
): TemplateCatalogDiagnosticView {
  const targetLabel = sanitizeTemplateDiagnosticTarget(diagnostic.targetPath, source);
  const jsonPath = safeJsonPath(diagnostic.path);
  return {
    id: stableDiagnosticId([
      source,
      diagnostic.code,
      targetLabel,
      jsonPath ?? '',
      String(occurrence),
    ]),
    code: diagnostic.code,
    source,
    severity: WARNING_CODES.has(diagnostic.code) ? 'warning' : 'error',
    targetLabel,
    ...(jsonPath ? { jsonPath } : {}),
    detail: DIAGNOSTIC_DETAIL[diagnostic.code],
    recovery: recoveryForCode(diagnostic.code),
  };
}

export function projectTemplateCatalogDiagnostics(
  diagnostics: readonly TemplateDiagnostic[],
  source: TemplateCatalogDiagnosticView['source'],
): TemplateCatalogDiagnosticView[] {
  const occurrences = new Map<string, number>();
  return diagnostics.map((diagnostic) => {
    const signature = `${diagnostic.code}\u001f${diagnostic.targetPath}\u001f${diagnostic.path ?? ''}`;
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    return projectTemplateCatalogDiagnostic(diagnostic, source, occurrence);
  });
}
