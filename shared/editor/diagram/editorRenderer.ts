import { getMermaid } from '../utils/mermaid';
import { isDiagramImageDataUrl } from '../../diagramRenderer';
import type { KnownDiagramLanguage } from './languages';
import { normalizeDiagramSvgSize } from './mediaSizing';
import {
  DiagramRenderError,
  type DiagramRenderRequest,
  type DiagramRenderer,
  type DiagramRendererResolver,
} from './types';

let mermaidRenderCounter = 0;

const renderMermaid: DiagramRenderer = async ({ code, signal }) => {
  const id = `mermaid-render-${Date.now()}-${mermaidRenderCounter++}`;
  try {
    const mermaid = await getMermaid();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { svg } = await mermaid.render(id, code);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return { kind: 'svg', ...normalizeDiagramSvgSize(svg) };
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
  | { kind: 'image'; dataUrl: string; width: number; height: number; alt?: string }
  | { kind: 'source-only'; reason?: string };

export type HostDiagramRenderer = (
  request: DiagramRenderRequest,
) => Promise<HostDiagramRenderResult>;

export const NOOP_HOST_DIAGRAM_RENDERER: HostDiagramRenderer =
  async () => ({ kind: 'source-only' });

export function createEditorDiagramRendererResolver(
  hostRenderer?: HostDiagramRenderer,
  externalRenderingAllowed = true,
): DiagramRendererResolver {
  return (language: KnownDiagramLanguage) => {
    if (language === 'mermaid') return renderMermaid;
    if (!externalRenderingAllowed) return undefined;
    if (!hostRenderer || hostRenderer === NOOP_HOST_DIAGRAM_RENDERER) return undefined;
    return async (request) => {
      const result = await hostRenderer(request);
      if (result.kind === 'image' && !isDiagramImageDataUrl(result.dataUrl)) {
        throw new DiagramRenderError('The diagram renderer returned an invalid image.', false);
      }
      return result;
    };
  };
}

export function createInteractionGatedDiagramRendererResolver(
  hostRenderer: HostDiagramRenderer | undefined,
  hasExplicitInteraction: () => boolean,
): DiagramRendererResolver {
  const resolver = createEditorDiagramRendererResolver(hostRenderer);
  return (language) => (
    language === 'mermaid' || hasExplicitInteraction()
      ? resolver(language)
      : undefined
  );
}
