import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { NOOP_EDITOR_EXTENSION_RUNTIME, type EditorExtensionOptions } from '../extensionRuntime';
import { renderKatexCached as renderKatex } from './katexRenderCache';
import { areNodeViewAttributesEqual } from './nodeViewUpdate';
import {
  attachMaterializationTriggers,
  createViewportMaterializer,
} from './viewportMaterializer';

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
      let currentNode = node;
      let currentLatex = node.attrs.latex;
      let isEditing = false;

      const dom = document.createElement('div');
      dom.classList.add('math-block');
      dom.setAttribute('contenteditable', 'false');
      dom.style.cursor = 'pointer';
      dom.title = runtime.translate('math.editHint');

      // --- Rendered math (visible when NOT editing) ---
      const renderedWrapper = document.createElement('div');
      renderedWrapper.classList.add('math-block-rendered-row');
      renderedWrapper.setAttribute('role', 'button');
      renderedWrapper.setAttribute('tabindex', '0');
      renderedWrapper.setAttribute('aria-label', runtime.translate('math.editHint'));
      renderedWrapper.setAttribute('aria-expanded', 'false');
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
      typeLabel.textContent = runtime.translate('math.block');
      toolbar.appendChild(typeLabel);

      const toggleBtn = document.createElement('button');
      toggleBtn.classList.add('math-edit-btn');
      toggleBtn.textContent = `→ ${runtime.translate('math.inline')}`;
      toggleBtn.title = runtime.translate('math.toInline');
      toolbar.appendChild(toggleBtn);

      const dialogBtn = document.createElement('button');
      dialogBtn.classList.add('math-edit-btn');
      dialogBtn.textContent = `⬒ ${runtime.translate('math.dialog')}`;
      dialogBtn.title = runtime.translate('math.editDialog');
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

      const updateStableGeometry = () => {
        const sourceLines = Math.max(1, currentLatex.split('\n').length);
        const intrinsicHeightRem = Math.min(12, 1.5 + sourceLines * 1.5);
        rendered.style.minHeight = `${intrinsicHeightRem}rem`;
        rendered.style.containIntrinsicBlockSize = `${intrinsicHeightRem}rem`;
      };

      const showSourcePlaceholder = () => {
        updateStableGeometry();
        rendered.classList.add('math-block-render-placeholder');
        rendered.textContent = currentLatex || '\\square';
      };

      const materializeRenderedMath = () => {
        updateStableGeometry();
        rendered.classList.remove('math-block-render-placeholder');
        renderKatex(currentLatex, rendered, true);
      };

      const stripDelimiters = (raw: string): string => {
        const v = raw.trim();
        if (v.startsWith('$$') && v.endsWith('$$') && v.length >= 4) return v.slice(2, -2).trim();
        return v;
      };

      const updateLivePreview = () => {
        renderKatex(stripDelimiters(textarea.value), livePreview, true);
      };

      showSourcePlaceholder();
      const viewportMaterializer = createViewportMaterializer({
        target: dom,
        materialize: materializeRenderedMath,
      });
      const ensureMaterialized = () => viewportMaterializer.ensure();
      const materializationTriggers = attachMaterializationTriggers(
        dom,
        typeof window === 'undefined' ? undefined : window,
        ensureMaterialized,
      );

      // Expose eq number setter directly on DOM for EquationNumbering plugin
      (dom as HTMLElement & { _setEqNumber?: (label: string | null) => void })._setEqNumber = (label) => {
        if (label == null) {
          eqNumber.style.display = 'none';
        } else {
          eqNumber.textContent = label;
          eqNumber.style.display = '';
        }
      };

      const commitEdit = () => {
        if (!isEditing) return;
        isEditing = false;
        renderedWrapper.setAttribute('aria-expanded', 'false');
        currentLatex = stripDelimiters(textarea.value);
        editContainer.style.display = 'none';
        rendered.style.display = '';
        materializeRenderedMath();
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
        renderedWrapper.setAttribute('aria-expanded', 'false');
        editContainer.style.display = 'none';
        rendered.style.display = '';
      };

      const enterEditMode = () => {
        if (isEditing) return;
        ensureMaterialized();
        isEditing = true;
        renderedWrapper.setAttribute('aria-expanded', 'true');
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
      renderedWrapper.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        enterEditMode();
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
          if (updatedNode.type !== currentNode.type) return false;
          if (areNodeViewAttributesEqual(currentNode.attrs, updatedNode.attrs)) {
            currentNode = updatedNode;
            return true;
          }
          currentNode = updatedNode;
          currentLatex = updatedNode.attrs.latex;
          if (!isEditing) {
            if (viewportMaterializer.materialized) materializeRenderedMath();
            else showSourcePlaceholder();
          }
          return true;
        },
        stopEvent: () => true,
        destroy() {
          viewportMaterializer.destroy();
          materializationTriggers.destroy();
        },
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
