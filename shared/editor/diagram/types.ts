import type { KnownDiagramLanguage } from './languages';

export interface DiagramRenderRequest {
  language: KnownDiagramLanguage;
  code: string;
  signal: AbortSignal;
}

export type DiagramRenderOutput =
  | { kind: 'svg'; markup: string }
  | { kind: 'png'; dataUrl: string; alt?: string };

export type DiagramRendererResult =
  | DiagramRenderOutput
  | { kind: 'source-only'; reason?: string };

export type DiagramRenderer = (
  request: DiagramRenderRequest,
) => Promise<DiagramRendererResult>;

export type DiagramRendererResolver = (
  language: KnownDiagramLanguage,
) => DiagramRenderer | undefined;

interface DiagramStateBase {
  language: string;
  code: string;
}

export type DiagramRenderState =
  | (DiagramStateBase & {
      status: 'source-only';
      reason:
        | 'empty-source'
        | 'unsupported-language'
        | 'renderer-unavailable'
        | 'renderer-declined';
      detail?: string;
    })
  | (DiagramStateBase & { status: 'loading' })
  | (DiagramStateBase & {
      status: 'ready';
      output: DiagramRenderOutput;
      cached: boolean;
    })
  | (DiagramStateBase & {
      status: 'error';
      message: string;
      retryable: boolean;
    });

export class DiagramRenderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'DiagramRenderError';
    this.retryable = retryable;
  }
}
