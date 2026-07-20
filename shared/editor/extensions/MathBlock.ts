import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import katex from 'katex';
import { NOOP_EDITOR_EXTENSION_RUNTIME, type EditorExtensionOptions } from '../extensionRuntime';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      insertMathBlock: (latex: string) => ReturnType;
    };
  }
}

export const MathBlock = Node.create<EditorExtensionOptions>({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-latex') || '',
        renderHTML: (attributes) => ({ 'data-latex': attributes.latex }),
      },
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id') || null,
        renderHTML: (attributes) => attributes.id ? { 'data-id': attributes.id } : {},
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
    const runtime = this.options.runtime;
    return ({ node, getPos, editor }) => {
      let currentLatex = node.attrs.latex;
      let isEditing = false;

      const dom = document.createElement('div');
      dom.classList.add('math-block');
      dom.setAttribute('contenteditable', 'false');
      dom.style.cursor = 'pointer';
      dom.title = '클릭하여 수식 편집 · 더블클릭으로 Dialog';

      // --- Rendered math (visible when NOT editing) ---
      const renderedWrapper = document.createElement('div');
      renderedWrapper.classList.add('math-block-rendered-row');
      dom.appendChild(renderedWrapper);

      const rendered = document.createElement('div');
      renderedWrapper.appendChild(rendered);

      const eqNumber = document.createElement('span');
      eqNumber.classList.add('eq-number');
      eqNumber.style.display = 'none';
      renderedWrapper.appendChild(eqNumber);

      // --- Edit container (visible when editing) ---
      const editContainer = document.createElement('div');
      editContainer.classList.add('math-edit-container');
      editContainer.style.display = 'none';
      dom.appendChild(editContainer);

      // Toolbar
      const toolbar = document.createElement('div');
      toolbar.classList.add('math-edit-toolbar');
      editContainer.appendChild(toolbar);

      const typeLabel = document.createElement('span');
      typeLabel.classList.add('math-edit-type-label');
      typeLabel.textContent = 'Block';
      toolbar.appendChild(typeLabel);

      const toggleBtn = document.createElement('button');
      toggleBtn.classList.add('math-edit-btn');
      toggleBtn.textContent = '→ Inline';
      toggleBtn.title = '인라인 수식으로 변환';
      toolbar.appendChild(toggleBtn);

      const dialogBtn = document.createElement('button');
      dialogBtn.classList.add('math-edit-btn');
      dialogBtn.textContent = '⬒ Dialog';
      dialogBtn.title = 'Dialog에서 편집';
      toolbar.appendChild(dialogBtn);

      // Textarea
      const textarea = document.createElement('textarea');
      textarea.rows = 3;
      textarea.spellcheck = false;
      textarea.classList.add('math-edit-input');
      editContainer.appendChild(textarea);

      // Live preview
      const livePreview = document.createElement('div');
      livePreview.classList.add('math-edit-preview', 'math-edit-preview--block');
      editContainer.appendChild(livePreview);

      const renderKatex = (latex: string, target: HTMLElement, displayMode: boolean) => {
        try {
          katex.render(latex || '\\square', target, {
            throwOnError: false,
            displayMode,
            output: 'htmlAndMathml',
          });
        } catch {
          target.textContent = latex;
        }
      };

      const stripDelimiters = (raw: string): string => {
        const v = raw.trim();
        if (v.startsWith('$$') && v.endsWith('$$') && v.length >= 4) return v.slice(2, -2).trim();
        return v;
      };

      const updateLivePreview = () => {
        renderKatex(stripDelimiters(textarea.value), livePreview, true);
      };

      renderKatex(currentLatex, rendered, true);

      // Expose eq number setter directly on DOM for EquationNumbering plugin
      (dom as HTMLElement & { _setEqNumber?: (label: string | null) => void })._setEqNumber = (label) => {
        if (label == null) {
          eqNumber.style.display = 'none';
        } else {
          eqNumber.textContent = `(${label})`;
          eqNumber.style.display = '';
        }
      };

      const commitEdit = () => {
        if (!isEditing) return;
        isEditing = false;
        currentLatex = stripDelimiters(textarea.value);
        editContainer.style.display = 'none';
        rendered.style.display = '';
        renderKatex(currentLatex, rendered, true);
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (pos != null) {
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, { latex: currentLatex })
            );
          }
        }
      };

      const cancelEdit = () => {
        if (!isEditing) return;
        isEditing = false;
        editContainer.style.display = 'none';
        rendered.style.display = '';
      };

      const enterEditMode = () => {
        if (isEditing) return;
        isEditing = true;
        textarea.value = `$$${currentLatex}$$`;
        editContainer.style.display = '';
        rendered.style.display = 'none';
        updateLivePreview();
        requestAnimationFrame(() => { textarea.focus(); textarea.select(); });
      };

      const openDialog = () => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (pos == null) return;
        if (isEditing) currentLatex = stripDelimiters(textarea.value);
        cancelEdit();
        runtime.openMathDialog(currentLatex, true, pos);
      };

      const toggleToInline = () => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (pos == null) return;
        if (isEditing) currentLatex = stripDelimiters(textarea.value);
        isEditing = false;
        editContainer.style.display = 'none';
        rendered.style.display = '';

        const { tr } = editor.state;
        const blockNode = tr.doc.nodeAt(pos);
        if (!blockNode) return;
        tr.replaceWith(pos, pos + blockNode.nodeSize,
          editor.schema.nodes.paragraph.create(null,
            editor.schema.nodes.mathInline.create({ latex: currentLatex })
          )
        );
        editor.view.dispatch(tr);
        runtime.flush();
      };

      // Single click → inline edit
      dom.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isEditing) enterEditMode();
      });

      // Double click → open dialog
      dom.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openDialog();
      });

      textarea.addEventListener('input', updateLivePreview);
      textarea.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
      textarea.addEventListener('blur', commitEdit);
      textarea.addEventListener('mousedown', (e) => e.stopPropagation());
      textarea.addEventListener('click', (e) => e.stopPropagation());

      // Toolbar buttons — mousedown preventDefault keeps textarea focused
      const preventBlur = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
      toggleBtn.addEventListener('mousedown', preventBlur);
      toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleToInline(); });
      dialogBtn.addEventListener('mousedown', preventBlur);
      dialogBtn.addEventListener('click', (e) => { e.stopPropagation(); openDialog(); });

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          currentLatex = updatedNode.attrs.latex;
          if (!isEditing) renderKatex(currentLatex, rendered, true);
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
