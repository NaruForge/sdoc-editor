import { isDiagramImageDataUrl, type DiagramRenderFailureCode } from '../diagramRenderer';
import {
  getKnownDiagramLanguage,
  resolveDiagramLanguage,
  type KnownDiagramLanguage,
} from '../editor/diagram/languages';
import type { TiptapNode } from '../types';

export type ExportDiagramLanguage = Exclude<KnownDiagramLanguage, 'mermaid'>;

export interface DiagramPreparationScope {
  kind: 'document' | 'chapter';
  scopeId: string;
  document: TiptapNode;
}

export interface PreparedExportDiagramImage {
  dataUrl: string;
  alt?: string;
}

export interface ExportDiagramRenderRequest {
  language: ExportDiagramLanguage;
  source: string;
  signal?: AbortSignal;
}

export type ExportDiagramRenderer = (request: ExportDiagramRenderRequest) => Promise<PreparedExportDiagramImage>;

export type DiagramPreparationDiagnosticCode =
  'unsupported-language' | 'renderer-unavailable' | 'render-failed' | 'invalid-image';

export interface DiagramPreparationDiagnostic {
  code: DiagramPreparationDiagnosticCode;
  language: string;
  occurrenceCount: number;
  chapterCount: number;
  reason?: Exclude<DiagramRenderFailureCode, 'cancelled'>;
}

export interface DiagramPreparationResult {
  status: 'completed' | 'fallback';
  occurrenceCount: number;
  scopeCount: number;
  chapterCount: number;
  uniqueDiagramCount: number;
  preparedOccurrenceCount: number;
  fallbackOccurrenceCount: number;
  fallbackChapterCount: number;
  diagnostics: readonly DiagramPreparationDiagnostic[];
  omittedDiagnosticCount: number;
  resolveDiagramImage(source: { language: string; code: string }): PreparedExportDiagramImage | undefined;
}

export interface DiagramPreparationOptions {
  render?: ExportDiagramRenderer;
  signal?: AbortSignal;
}

interface DiagramOccurrenceGroup {
  language: string;
  knownLanguage?: ExportDiagramLanguage;
  source: string;
  occurrenceCount: number;
  scopeIndexes: Set<number>;
  chapterIndexes: Set<number>;
}

const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_LANGUAGE_LENGTH = 64;
const DIAGRAM_RENDER_FAILURE_CODES = new Set<DiagramRenderFailureCode>([
  'disabled',
  'invalid-endpoint',
  'blocked-address',
  'source-too-large',
  'timeout',
  'offline',
  'rate-limited',
  'server-error',
  'redirect',
  'response-too-large',
  'invalid-response',
  'cancelled',
]);

function asExportLanguage(language: KnownDiagramLanguage | undefined): ExportDiagramLanguage | undefined {
  return language && language !== 'mermaid' ? language : undefined;
}

function diagnosticLanguage(language: string): string {
  const normalized = language.trim() || 'unknown';
  return normalized.length <= MAX_DIAGNOSTIC_LANGUAGE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_DIAGNOSTIC_LANGUAGE_LENGTH - 1)}…`;
}

function getFailureCode(error: unknown): DiagramRenderFailureCode | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' && DIAGRAM_RENDER_FAILURE_CODES.has(code as DiagramRenderFailureCode)
    ? (code as DiagramRenderFailureCode)
    : undefined;
}

function throwIfCancellation(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) signal.throwIfAborted();
  if (getFailureCode(error) === 'cancelled' || (error instanceof Error && error.name === 'AbortError')) {
    throw error;
  }
}

function isExpectedPreparedImage(language: ExportDiagramLanguage, image: PreparedExportDiagramImage): boolean {
  if (!isDiagramImageDataUrl(image.dataUrl)) return false;
  return language === 'd2'
    ? image.dataUrl.startsWith('data:image/svg+xml;base64,')
    : image.dataUrl.startsWith('data:image/png;base64,');
}

function scanScopes(scopes: readonly DiagramPreparationScope[]): DiagramOccurrenceGroup[] {
  const groups: DiagramOccurrenceGroup[] = [];
  const byLanguage = new Map<string, Map<string, DiagramOccurrenceGroup>>();

  scopes.forEach((scope, scopeIndex) => {
    const pending: TiptapNode[] = [scope.document];
    while (pending.length > 0) {
      const node = pending.pop();
      if (!node) continue;
      if (node.type === 'diagram') {
        const language = resolveDiagramLanguage(node.attrs?.language);
        const known = getKnownDiagramLanguage(language);
        if (known !== 'mermaid') {
          const source = typeof node.attrs?.code === 'string' ? node.attrs.code : '';
          let bySource = byLanguage.get(language);
          if (!bySource) {
            bySource = new Map();
            byLanguage.set(language, bySource);
          }
          let group = bySource.get(source);
          if (!group) {
            group = {
              language,
              knownLanguage: asExportLanguage(known),
              source,
              occurrenceCount: 0,
              scopeIndexes: new Set(),
              chapterIndexes: new Set(),
            };
            bySource.set(source, group);
            groups.push(group);
          }
          group.occurrenceCount += 1;
          group.scopeIndexes.add(scopeIndex);
          if (scope.kind === 'chapter') group.chapterIndexes.add(scopeIndex);
        }
      }
      if (node.content) {
        for (let index = node.content.length - 1; index >= 0; index -= 1) {
          pending.push(node.content[index]);
        }
      }
    }
  });
  return groups;
}

export async function prepareExportDiagrams(
  scopes: readonly DiagramPreparationScope[],
  options: DiagramPreparationOptions = {},
): Promise<DiagramPreparationResult> {
  options.signal?.throwIfAborted();
  const groups = scanScopes(scopes);
  options.signal?.throwIfAborted();

  const prepared = new Map<ExportDiagramLanguage, Map<string, PreparedExportDiagramImage>>();
  const diagnostics: DiagramPreparationDiagnostic[] = [];
  let omittedDiagnosticCount = 0;
  let preparedOccurrenceCount = 0;
  let fallbackOccurrenceCount = 0;
  const fallbackChapters = new Set<number>();

  const recordFallback = (
    group: DiagramOccurrenceGroup,
    code: DiagramPreparationDiagnosticCode,
    reason?: Exclude<DiagramRenderFailureCode, 'cancelled'>,
  ): void => {
    fallbackOccurrenceCount += group.occurrenceCount;
    group.chapterIndexes.forEach((index) => fallbackChapters.add(index));
    const diagnostic: DiagramPreparationDiagnostic = {
      code,
      language: diagnosticLanguage(group.language),
      occurrenceCount: group.occurrenceCount,
      chapterCount: group.chapterIndexes.size,
      ...(reason ? { reason } : {}),
    };
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
    else omittedDiagnosticCount += 1;
  };

  for (const group of groups) {
    options.signal?.throwIfAborted();
    if (!group.knownLanguage) {
      recordFallback(group, 'unsupported-language');
      continue;
    }
    if (!options.render) {
      recordFallback(group, 'renderer-unavailable');
      continue;
    }

    try {
      const image = await options.render({
        language: group.knownLanguage,
        source: group.source,
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
      if (!isExpectedPreparedImage(group.knownLanguage, image)) {
        recordFallback(group, 'invalid-image');
        continue;
      }
      let bySource = prepared.get(group.knownLanguage);
      if (!bySource) {
        bySource = new Map();
        prepared.set(group.knownLanguage, bySource);
      }
      bySource.set(group.source, image);
      preparedOccurrenceCount += group.occurrenceCount;
    } catch (error) {
      throwIfCancellation(error, options.signal);
      const reason = getFailureCode(error);
      recordFallback(group, 'render-failed', reason && reason !== 'cancelled' ? reason : undefined);
    }
  }

  const affectedScopes = new Set<number>();
  const affectedChapters = new Set<number>();
  let occurrenceCount = 0;
  for (const group of groups) {
    occurrenceCount += group.occurrenceCount;
    group.scopeIndexes.forEach((index) => affectedScopes.add(index));
    group.chapterIndexes.forEach((index) => affectedChapters.add(index));
  }

  return {
    status: fallbackOccurrenceCount > 0 ? 'fallback' : 'completed',
    occurrenceCount,
    scopeCount: affectedScopes.size,
    chapterCount: affectedChapters.size,
    uniqueDiagramCount: groups.length,
    preparedOccurrenceCount,
    fallbackOccurrenceCount,
    fallbackChapterCount: fallbackChapters.size,
    diagnostics,
    omittedDiagnosticCount,
    resolveDiagramImage: ({ language, code }) => {
      const known = asExportLanguage(getKnownDiagramLanguage(language));
      return known ? prepared.get(known)?.get(code) : undefined;
    },
  };
}
