import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import katex from 'katex';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      insertMathBlock: (latex: string) => ReturnType;
    };
  }
}

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-latex') || '',
        renderHTML: (attributes) => ({ 'data-latex': attributes.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' }), 0];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentLatex = node.attrs.latex;
      let isEditing = false;

      const dom = document.createElement('div');
      dom.classList.add('math-block');
      dom.setAttribute('contenteditable', 'false');
      dom.style.cursor = 'pointer';
      dom.title = '클릭하여 수식 편집';

      const rendered = document.createElement('div');
      dom.appendChild(rendered);

      const textarea = document.createElement('textarea');
      textarea.rows = 3;
      textarea.spellcheck = false;
      textarea.style.display = 'none';
      textarea.style.width = '100%';
      textarea.style.boxSizing = 'border-box';
      textarea.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
      textarea.style.fontSize = '0.9em';
      textarea.style.border = '1px solid var(--vscode-focusBorder, #007fd4)';
      textarea.style.borderRadius = '3px';
      textarea.style.padding = '4px 8px';
      textarea.style.background = 'var(--vscode-input-background, #1e1e1e)';
      textarea.style.color = 'var(--vscode-input-foreground, #d4d4d4)';
      textarea.style.outline = 'none';
      textarea.style.resize = 'vertical';
      dom.appendChild(textarea);

      const renderMath = (latex: string) => {
        try {
          katex.render(latex || '\\square', rendered, {
            throwOnError: false,
            displayMode: true,
            output: 'htmlAndMathml',
          });
        } catch {
          rendered.textContent = latex;
        }
      };

      renderMath(currentLatex);

      const commitEdit = () => {
        if (!isEditing) return;
        isEditing = false;
        let value = textarea.value.trim();
        if (value.startsWith('$$') && value.endsWith('$$') && value.length >= 4) {
          value = value.slice(2, -2).trim();
        }
        currentLatex = value;
        textarea.style.display = 'none';
        rendered.style.display = '';
        renderMath(currentLatex);
        if (typeof getPos === 'function') {
          const tr = editor.state.tr.setNodeMarkup(getPos() as number, undefined, { latex: value });
          editor.view.dispatch(tr);
        }
      };

      const cancelEdit = () => {
        if (!isEditing) return;
        isEditing = false;
        textarea.style.display = 'none';
        rendered.style.display = '';
      };

      const enterEditMode = () => {
        if (isEditing) return;
        isEditing = true;
        textarea.value = `$$${currentLatex}$$`;
        textarea.style.display = 'block';
        rendered.style.display = 'none';
        requestAnimationFrame(() => { textarea.focus(); textarea.select(); });
      };

      dom.addEventListener('click', (e) => { e.stopPropagation(); enterEditMode(); });
      textarea.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
      textarea.addEventListener('blur', commitEdit);
      textarea.addEventListener('mousedown', (e) => e.stopPropagation());
      textarea.addEventListener('click', (e) => e.stopPropagation());

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          currentLatex = updatedNode.attrs.latex;
          if (!isEditing) renderMath(currentLatex);
          return true;
        },
        stopEvent: () => true,
      };
    };
  },

  addInputRules() {
    return [
      new InputRule({
        // $$수식$$ 형태를 블록 수식 노드로 변환
        find: /^\$\$([^\$\n]*)\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex },
          });
        },
    };
  },
});
