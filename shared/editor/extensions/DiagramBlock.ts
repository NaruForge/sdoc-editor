import { Node, mergeAttributes } from '@tiptap/core';
import {
  createInteractionGatedDiagramRendererResolver,
  DiagramRenderIntentStore,
  DiagramRenderCoordinator,
  resolveDiagramLanguage,
  type DiagramRenderState,
} from '../diagram';
import { NOOP_EDITOR_EXTENSION_RUNTIME, type EditorExtensionOptions } from '../extensionRuntime';
import { areNodeViewAttributesEqual } from './nodeViewUpdate';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diagramBlock: {
      insertDiagram: (
        language: string,
        code: string,
        renderAfterInsert?: boolean,
      ) => ReturnType;
    };
  }
}

interface DiagramBlockStorage {
  renderIntents: DiagramRenderIntentStore;
}

export const DiagramBlock = Node.create<EditorExtensionOptions, DiagramBlockStorage>({
  name: 'diagram',
  group: 'block',
  atom: true,

  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },

  addStorage() {
    return { renderIntents: new DiagramRenderIntentStore() };
  },

  addAttributes() {
    return {
      language: {
        default: 'mermaid',
        parseHTML: (element) => element.getAttribute('data-language') || 'mermaid',
        renderHTML: (attributes) => ({ 'data-language': attributes.language }),
      },
      code: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-code') || '',
        renderHTML: (attributes) => ({ 'data-code': attributes.code }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-diagram]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-diagram': '' }), 0];
  },

  addCommands() {
    return {
      insertDiagram:
        (language: string, code: string, renderAfterInsert = false) =>
        ({ commands }) => {
          const resolvedLanguage = resolveDiagramLanguage(language);
          if (renderAfterInsert) this.storage.renderIntents.mark(resolvedLanguage, code);
          const inserted = commands.insertContent({
            type: this.name,
            attrs: { language: resolvedLanguage, code },
          });
          if (!inserted && renderAfterInsert) {
            this.storage.renderIntents.discard(resolvedLanguage, code);
          }
          return inserted;
        },
    };
  },

  addNodeView() {
    const runtime = this.options.runtime;
    const { renderIntents } = this.storage;
    return ({ node, getPos }) => {
      const dom = document.createElement('div');
      dom.classList.add('diagram-block');
      dom.setAttribute('contenteditable', 'false');
      dom.setAttribute('role', 'group');
      dom.setAttribute('tabindex', '0');
      dom.setAttribute('aria-label', runtime.translate('diagram.editHint'));
      dom.style.cursor = 'pointer';
      dom.title = runtime.translate('diagram.editHint');

      const badge = document.createElement('span');
      badge.className = 'diagram-language-badge';
      badge.textContent = resolveDiagramLanguage(node.attrs.language);
      dom.appendChild(badge);

      const rendered = document.createElement('div');
      rendered.className = 'diagram-rendered';
      rendered.setAttribute('role', 'status');
      rendered.setAttribute('aria-live', 'polite');
      dom.appendChild(rendered);

      let coordinator: DiagramRenderCoordinator;
      const showState = (state: DiagramRenderState) => {
        rendered.setAttribute('aria-busy', String(state.status === 'loading'));
        if (state.status === 'loading') {
          const placeholder = document.createElement('div');
          placeholder.className = 'diagram-placeholder';
          placeholder.textContent = `${runtime.translate('diagram.preview')}…`;
          rendered.replaceChildren(placeholder);
          return;
        }
        if (state.status === 'ready') {
          if (state.output.kind === 'svg') {
            rendered.innerHTML = state.output.markup;
          } else {
            const image = document.createElement('img');
            image.src = state.output.dataUrl;
            image.alt = state.output.alt ?? `${state.language} diagram`;
            image.setAttribute('width', String(state.output.width));
            image.setAttribute('height', String(state.output.height));
            rendered.replaceChildren(image);
          }
          return;
        }
        if (state.status === 'error') {
          const error = document.createElement('div');
          error.className = 'diagram-error';
          error.textContent = state.message;
          if (state.retryable) {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'btn-secondary';
            retry.textContent = 'Retry';
            retry.addEventListener('click', (event) => {
              event.stopPropagation();
              coordinator.retry();
            });
            error.appendChild(retry);
          }
          const pre = document.createElement('pre');
          pre.dataset.language = state.language;
          const source = document.createElement('code');
          source.textContent = state.code;
          pre.appendChild(source);
          error.appendChild(pre);
          rendered.replaceChildren(error);
          return;
        }

        const sourceOnly = document.createElement('div');
        if (state.reason === 'empty-source') {
          const placeholder = document.createElement('div');
          placeholder.className = 'diagram-placeholder';
          placeholder.textContent = runtime.translate('diagram.codePlaceholder');
          sourceOnly.appendChild(placeholder);
        } else {
          const explanation = document.createElement('div');
          explanation.className = 'diagram-placeholder';
          explanation.textContent = state.reason === 'unsupported-language'
            ? `${state.language}: source only. You can edit and save the source.`
            : state.detail
              ?? runtime.translate('diagram.unsupportedRenderer', {
                language: state.language,
              });
          sourceOnly.appendChild(explanation);
          const pre = document.createElement('pre');
          pre.dataset.language = state.language;
          const source = document.createElement('code');
          source.textContent = state.code;
          pre.appendChild(source);
          sourceOnly.appendChild(pre);
        }
        rendered.replaceChildren(sourceOnly);
      };

      let externalRenderingRequested = renderIntents.consume(
        node.attrs.language,
        node.attrs.code,
      );
      coordinator = new DiagramRenderCoordinator({
        resolveRenderer: createInteractionGatedDiagramRendererResolver(
          runtime.renderDiagram,
          () => externalRenderingRequested,
        ),
        onStateChange: showState,
      });
      coordinator.setInput(node.attrs.language, node.attrs.code);

      const openDialog = () => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (pos != null) {
          externalRenderingRequested = true;
          runtime.openDiagramDialog(node.attrs.code, node.attrs.language, pos);
        }
      };
      dom.addEventListener('click', openDialog);
      dom.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDialog();
        }
      });

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'diagram') return false;
          if (areNodeViewAttributesEqual(node.attrs, updatedNode.attrs)) {
            node = updatedNode;
            return true;
          }
          node = updatedNode;
          badge.textContent = resolveDiagramLanguage(updatedNode.attrs.language);
          coordinator.setInput(updatedNode.attrs.language, updatedNode.attrs.code);
          return true;
        },
        destroy() {
          coordinator.dispose();
        },
      };
    };
  },
});
