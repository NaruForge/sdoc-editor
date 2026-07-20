import { Table } from '@tiptap/extension-table';

export const CustomTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-caption'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const caption = typeof attributes.caption === 'string' ? attributes.caption : '';
          return caption ? { 'data-caption': caption } : {};
        },
      },
      align: {
        default: 'left',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-align'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const align = typeof attributes.align === 'string' ? attributes.align : '';
          return align ? { 'data-align': align } : {};
        },
      },
      width: {
        default: '100%',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-width'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const width = typeof attributes.width === 'string' ? attributes.width : '';
          return width ? { 'data-width': width } : {};
        },
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node;
      let isEditingCaption = false;

      // === Build DOM ===
      const wrapper = document.createElement('div');
      wrapper.classList.add('table-node-wrapper');

      // -- Caption display (visible when not editing) --
      const captionDisplay = document.createElement('div');
      captionDisplay.classList.add('table-caption-display');
      captionDisplay.setAttribute('contenteditable', 'false');
      wrapper.appendChild(captionDisplay);

      // -- Caption input (visible only when editing) --
      const captionInputWrapper = document.createElement('div');
      captionInputWrapper.classList.add('caption-input-wrapper');
      captionInputWrapper.style.display = 'none';
      captionInputWrapper.setAttribute('contenteditable', 'false');

      const captionInput = document.createElement('input');
      captionInput.type = 'text';
      captionInput.classList.add('caption-input');
      captionInput.placeholder = 'Enter table caption...';
      captionInputWrapper.appendChild(captionInput);
      wrapper.appendChild(captionInputWrapper);

      // -- Table container (width & alignment) --
      const tableContainer = document.createElement('div');
      tableContainer.classList.add('table-container');
      wrapper.appendChild(tableContainer);

      const table = document.createElement('table');
      tableContainer.appendChild(table);

      const tbody = document.createElement('tbody');
      table.appendChild(tbody);

      // === Helper: update caption display ===
      function refreshCaption() {
        if (isEditingCaption) return; // don't touch display while editing

        const cap = currentNode.attrs.caption;
        captionDisplay.innerHTML = '';

        if (cap) {
          captionDisplay.classList.add('has-caption');
          captionDisplay.classList.remove('no-caption');

          const label = document.createElement('span');
          label.className = 'caption-label';
          captionDisplay.appendChild(label);

          const text = document.createElement('span');
          text.className = 'caption-text';
          text.textContent = cap;
          captionDisplay.appendChild(text);

          const icon = document.createElement('span');
          icon.className = 'caption-edit-icon';
          icon.textContent = ' ✎';
          captionDisplay.appendChild(icon);
        } else {
          captionDisplay.classList.remove('has-caption');
          captionDisplay.classList.add('no-caption');

          const ph = document.createElement('span');
          ph.className = 'caption-placeholder';
          ph.textContent = 'Click to add caption...';
          captionDisplay.appendChild(ph);
        }
      }

      // === Helper: update table styles ===
      function refreshStyles() {
        const w = currentNode.attrs.width || '100%';
        const a = currentNode.attrs.align || 'left';

        if (w === 'auto') {
          tableContainer.style.width = 'fit-content';
          table.style.width = 'auto';
          table.style.tableLayout = 'auto';
        } else {
          tableContainer.style.width = w;
          table.style.width = '100%';
          table.style.tableLayout = 'fixed';
        }

        tableContainer.style.marginLeft =
          a === 'center' || a === 'right' ? 'auto' : '0';
        tableContainer.style.marginRight =
          a === 'center' || a === 'left' ? 'auto' : '0';
      }

      // === Helper: commit caption value from input ===
      function commitCaption() {
        if (!isEditingCaption) return;
        isEditingCaption = false;

        const newValue = captionInput.value.trim() || null;
        captionInputWrapper.style.display = 'none';
        captionDisplay.style.display = '';

        // Use Tiptap's chain API to trigger onUpdate properly
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.chain().focus().command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                caption: newValue,
              });
              return true;
            }).run();

            // Immediately flush update to avoid debounce delay
            if (window.__editorFlushUpdate) {
              window.__editorFlushUpdate();
            }
          }
        }
      }

      // === Caption display click → start editing ===
      captionDisplay.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        isEditingCaption = true;
        captionDisplay.style.display = 'none';
        captionInputWrapper.style.display = '';
        captionInput.value = currentNode.attrs.caption || '';

        // Focus input after a microtask to avoid PM interference
        requestAnimationFrame(() => {
          captionInput.focus();
          captionInput.select();
        });
      });

      // === Caption input: Enter → save, Escape → cancel ===
      captionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitCaption();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          isEditingCaption = false;
          captionInputWrapper.style.display = 'none';
          captionDisplay.style.display = '';
          refreshCaption();
          editor.commands.focus();
        }
        e.stopPropagation(); // Prevent PM from intercepting keys
      });

      captionInput.addEventListener('blur', () => {
        // Small delay to allow click events to process first
        setTimeout(() => {
          if (isEditingCaption) {
            commitCaption();
          }
        }, 100);
      });

      // === Initial render ===
      refreshCaption();
      refreshStyles();

      // === NodeView interface ===
      return {
        dom: wrapper,
        contentDOM: tbody,

        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false;
          currentNode = updatedNode;
          refreshCaption();
          refreshStyles();
          return true;
        },

        ignoreMutation(mutation: MutationRecord | { type: 'selection' }) {
          if (mutation.type === 'selection') return false;
          const target = (mutation as MutationRecord).target;
          if (!target) return true;
          // Ignore all mutations outside tbody (our caption/style changes)
          return !tbody.contains(target);
        },

        stopEvent(event: Event) {
          const target = event.target as HTMLElement;
          if (!target) return false;
          // Stop ProseMirror from handling events OUTSIDE the table body
          // This ensures caption area & input events are ours to handle
          return !tbody.contains(target);
        },

        destroy() {},
      };
    };
  },
});
