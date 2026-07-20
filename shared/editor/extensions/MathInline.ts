import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import katex from 'katex';
import { NOOP_EDITOR_EXTENSION_RUNTIME, type EditorExtensionOptions } from '../extensionRuntime';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathInline: {
      insertMathInline: (latex: string) => ReturnType;
    };
  }
}

export const MathInline = Node.create<EditorExtensionOptions>({
  name: 'mathInline',
  group: 'inline',
  inline: true,
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
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' }), 0];
  },

  addNodeView() {
    const runtime = this.options.runtime;
    return ({ node, getPos, editor }) => {
      let currentLatex = node.attrs.latex;
      let isEditing = false;

      const dom = document.createElement('span');
      dom.classList.add('math-inline');
      dom.setAttribute('contenteditable', 'false');
      dom.style.cursor = 'pointer';
      dom.style.position = 'relative';
      dom.title = '클릭하여 수식 편집 · 더블클릭으로 Dialog';

      // --- Rendered math (visible when NOT editing) ---
      const rendered = document.createElement('span');
      dom.appendChild(rendered);

      // --- Input (visible when editing) ---
      const input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.classList.add('math-edit-input', 'math-edit-input--inline');
      input.style.display = 'none';
      dom.appendChild(input);

      // --- Floating edit panel (preview + toolbar) ---
      const editPanel = document.createElement('div');
      editPanel.classList.add('math-edit-panel');
      editPanel.style.display = 'none';
      dom.appendChild(editPanel);

      const livePreview = document.createElement('div');
      livePreview.classList.add('math-edit-preview');
      editPanel.appendChild(livePreview);

      const toolbar = document.createElement('div');
      toolbar.classList.add('math-edit-toolbar');
      editPanel.appendChild(toolbar);

      const typeLabel = document.createElement('span');
      typeLabel.classList.add('math-edit-type-label');
      typeLabel.textContent = 'Inline';
      toolbar.appendChild(typeLabel);

      const toggleBtn = document.createElement('button');
      toggleBtn.classList.add('math-edit-btn');
      toggleBtn.textContent = '→ Block';
      toggleBtn.title = '블록 수식으로 변환';
      toolbar.appendChild(toggleBtn);

      const dialogBtn = document.createElement('button');
      dialogBtn.classList.add('math-edit-btn');
      dialogBtn.textContent = '⬒ Dialog';
      dialogBtn.title = 'Dialog에서 편집';
      toolbar.appendChild(dialogBtn);

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
        if (v.startsWith('$') && v.endsWith('$') && v.length >= 2) {
          const inner = v.slice(1, -1);
          if (!inner.startsWith('$')) return inner.trim();
        }
        return v;
      };

      const updateLivePreview = () => {
        renderKatex(stripDelimiters(input.value), livePreview, false);
      };

      renderKatex(currentLatex, rendered, false);

      const commitEdit = () => {
        if (!isEditing) return;
        isEditing = false;
        currentLatex = stripDelimiters(input.value);
        input.style.display = 'none';
        editPanel.style.display = 'none';
        rendered.style.display = '';
        renderKatex(currentLatex, rendered, false);
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
        input.style.display = 'none';
        editPanel.style.display = 'none';
        rendered.style.display = '';
      };

      const enterEditMode = () => {
        if (isEditing) return;
        isEditing = true;
        input.value = `$${currentLatex}$`;
        input.style.display = 'inline-block';
        input.style.width = `${Math.max(80, currentLatex.length * 9 + 30)}px`;
        editPanel.style.display = '';
        rendered.style.display = 'none';
        updateLivePreview();
        requestAnimationFrame(() => { input.focus(); input.select(); });
      };

      const openDialog = () => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (pos == null) return;
        if (isEditing) currentLatex = stripDelimiters(input.value);
        cancelEdit();
        runtime.openMathDialog(currentLatex, false, pos);
      };

      const toggleToBlock = () => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (pos == null) return;
        if (isEditing) currentLatex = stripDelimiters(input.value);
        isEditing = false;
        input.style.display = 'none';
        editPanel.style.display = 'none';
        rendered.style.display = '';

        const { tr } = editor.state;
        const inlineNode = tr.doc.nodeAt(pos);
        if (!inlineNode) return;
        const $pos = tr.doc.resolve(pos);
        const mathBlockType = editor.schema.nodes.mathBlock;

        if ($pos.parent.childCount === 1 && $pos.parent.type.name === 'paragraph') {
          // Sole child of paragraph — replace entire paragraph
          tr.replaceWith($pos.before($pos.depth), $pos.after($pos.depth),
            mathBlockType.create({ latex: currentLatex })
          );
        } else {
          // Has siblings — delete inline, insert block after paragraph
          const parentEnd = $pos.after($pos.depth);
          tr.delete(pos, pos + inlineNode.nodeSize);
          tr.insert(tr.mapping.map(parentEnd), mathBlockType.create({ latex: currentLatex }));
        }
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

      input.addEventListener('input', () => {
        input.style.width = `${Math.max(80, input.value.length * 8 + 20)}px`;
        updateLivePreview();
      });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
      input.addEventListener('blur', commitEdit);
      input.addEventListener('mousedown', (e) => e.stopPropagation());
      input.addEventListener('click', (e) => e.stopPropagation());

      // Toolbar buttons — mousedown preventDefault keeps input focused
      const preventBlur = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
      toggleBtn.addEventListener('mousedown', preventBlur);
      toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleToBlock(); });
      dialogBtn.addEventListener('mousedown', preventBlur);
      dialogBtn.addEventListener('click', (e) => { e.stopPropagation(); openDialog(); });
      editPanel.addEventListener('mousedown', preventBlur);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          currentLatex = updatedNode.attrs.latex;
          if (!isEditing) renderKatex(currentLatex, rendered, false);
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
