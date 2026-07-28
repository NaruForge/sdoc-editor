import { getMermaid } from '../utils/mermaid';
import type { KnownDiagramLanguage } from './languages';
import {
  DiagramRenderError,
  type DiagramRenderRequest,
  type DiagramRenderer,
  type DiagramRendererResolver,
} from './types';

let mermaidRenderCounter = 0;

function isPngDataUrl(value: string): boolean {
  return /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(value);
}

const renderMermaid: DiagramRenderer = async ({ code, signal }) => {
  const id = `mermaid-render-${Date.now()}-${mermaidRenderCounter++}`;
  try {
    const mermaid = await getMermaid();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { svg } = await mermaid.render(id, code);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return { kind: 'svg', markup: svg };
  } catch (error: unknown) {
    document.getElementById(id)?.remove();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new DiagramRenderError(
      error instanceof Error ? error.message : 'Invalid Mermaid source.',
      false,
    );
  }
};

export type HostDiagramRenderResult =
  | { kind: 'png'; dataUrl: string; alt?: string }
  | { kind: 'source-only'; reason?: string };

export type HostDiagramRenderer = (
  request: DiagramRenderRequest,
) => Promise<HostDiagramRenderResult>;

export const NOOP_HOST_DIAGRAM_RENDERER: HostDiagramRenderer =
  async () => ({ kind: 'source-only' });

export function createEditorDiagramRendererResolver(
  hostRenderer?: HostDiagramRenderer,
): DiagramRendererResolver {
  return (language: KnownDiagramLanguage) => {
    if (language === 'mermaid') return renderMermaid;
    if (!hostRenderer || hostRenderer === NOOP_HOST_DIAGRAM_RENDERER) return undefined;
    return async (request) => {
      const result = await hostRenderer(request);
      if (result.kind === 'png' && !isPngDataUrl(result.dataUrl)) {
        throw new DiagramRenderError('The diagram renderer returned an invalid PNG.', false);
      }
      return result;
    };
  };
}
