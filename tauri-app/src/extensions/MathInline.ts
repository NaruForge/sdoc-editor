import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import katex from 'katex';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathInline: {
      insertMathInline: (latex: string) => ReturnType;
    };
  }
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
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
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' }), 0];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentLatex = node.attrs.latex;
      let isEditing = false;

      const dom = document.createElement('span');
      dom.classList.add('math-inline');
      dom.setAttribute('contenteditable', 'false');
      dom.style.cursor = 'pointer';
      dom.title = '클릭하여 수식 편집';

      const rendered = document.createElement('span');
      dom.appendChild(rendered);

      const input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.style.display = 'none';
      input.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
      input.style.fontSize = '0.9em';
      input.style.border = '1px solid var(--vscode-focusBorder, #007fd4)';
      input.style.borderRadius = '3px';
      input.style.padding = '1px 4px';
      input.style.background = 'var(--vscode-input-background, #1e1e1e)';
      input.style.color = 'var(--vscode-input-foreground, #d4d4d4)';
      input.style.outline = 'none';
      input.style.minWidth = '80px';
      dom.appendChild(input);

      const renderMath = (latex: string) => {
        try {
          katex.render(latex || '\\square', rendered, {
            throwOnError: false,
            displayMode: false,
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
        let value = input.value.trim();
        if (value.startsWith('$') && value.endsWith('$') && value.length >= 2) {
          value = value.slice(1, -1);
        }
        currentLatex = value;
        input.style.display = 'none';
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
        input.style.display = 'none';
        rendered.style.display = '';
      };

      const enterEditMode = () => {
        if (isEditing) return;
        isEditing = true;
        input.value = `$${currentLatex}$`;
        input.style.display = 'inline-block';
        input.style.width = `${Math.max(80, currentLatex.length * 9 + 30)}px`;
        rendered.style.display = 'none';
        requestAnimationFrame(() => { input.focus(); input.select(); });
      };

      dom.addEventListener('click', (e) => { e.stopPropagation(); enterEditMode(); });
      input.addEventListener('input', () => {
        input.style.width = `${Math.max(80, input.value.length * 8 + 20)}px`;
      });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
      input.addEventListener('blur', commitEdit);
      input.addEventListener('mousedown', (e) => e.stopPropagation());
      input.addEventListener('click', (e) => e.stopPropagation());

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
        // $수식$ 형태를 인라인 수식 노드로 변환
        find: /\$([^\$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertMathInline:
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
