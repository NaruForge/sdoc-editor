import { Node, mergeAttributes } from '@tiptap/core';
import { getMermaid } from '../utils/mermaid';

let diagramCounter = 0;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diagramBlock: {
      insertDiagram: (language: string, code: string) => ReturnType;
    };
  }
}

async function renderMermaid(code: string, container: HTMLElement): Promise<void> {
  const id = `mermaid-render-${Date.now()}-${diagramCounter++}`;
  try {
    const mermaid = await getMermaid();
    const { svg } = await mermaid.render(id, code);
    container.innerHTML = svg;
  } catch (e: unknown) {
    // mermaid.render creates a temp element with the id; clean it up on error
    const errEl = document.getElementById(id);
    if (errEl) errEl.remove();
    const error = document.createElement('div');
    error.className = 'diagram-error';
    error.textContent = e instanceof Error ? e.message : 'Render error';
    container.replaceChildren(error);
  }
}

export const DiagramBlock = Node.create({
  name: 'diagram',
  group: 'block',
  atom: true,

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
        (language: string, code: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { language, code },
          });
        },
    };
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement('div');
      dom.classList.add('diagram-block');
      dom.setAttribute('contenteditable', 'false');
      dom.style.cursor = 'pointer';
      dom.title = '클릭하여 다이어그램 편집';

      // Language badge
      const badge = document.createElement('span');
      badge.className = 'diagram-language-badge';
      badge.textContent = node.attrs.language || 'mermaid';
      dom.appendChild(badge);

      // Rendered SVG area
      const rendered = document.createElement('div');
      rendered.className = 'diagram-rendered';
      dom.appendChild(rendered);

      const renderDiagram = async (language: string, code: string) => {
        if (!code.trim()) {
          rendered.innerHTML = '<div class="diagram-placeholder">클릭하여 다이어그램 코드를 입력하세요</div>';
          return;
        }
        if (language === 'mermaid') {
          await renderMermaid(code, rendered);
        } else {
          // Future: Kroki support
          rendered.innerHTML = `<div class="diagram-placeholder">${language} rendering not yet supported. Configure a Kroki server.</div>`;
        }
      };

      renderDiagram(node.attrs.language, node.attrs.code);

      // Click → open dialog via global handler
      dom.addEventListener('click', () => {
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (pos != null) {
            window.__showDiagramDialog?.(
              node.attrs.code,
              node.attrs.language,
              pos,
            );
          }
        }
      });

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'diagram') return false;
          badge.textContent = updatedNode.attrs.language || 'mermaid';
          renderDiagram(updatedNode.attrs.language, updatedNode.attrs.code);
          return true;
        },
        destroy() {},
      };
    };
  },
});
