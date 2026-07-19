import { Image } from '@tiptap/extension-image';

// Read default alignment from global settings (set by Editor.tsx)
function getDefaultAlignment(): string {
  return (window as any).__editorSettings?.defaultImageAlignment || 'center';
}

/**
 * Legacy fallback: reconstruct the "./images/..." or "./drawio/..." relative path from an
 * asset.localhost URL when no `relativePath` node attribute is available (e.g. documents
 * created before this attribute was introduced).
 *
 * Windows absolute paths use backslash separators, so `convertFileSrc` percent-encodes them
 * as `%5C` instead of a literal `/`. Decoding first lets a single regex handle both Windows
 * (`%5C`) and POSIX (`/`) encoded paths.
 */
export function extractRelativePathFromSrc(src: string): string | null {
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    // Malformed URI — fall back to the raw string
  }
  const match = decoded.match(/(images|drawio)[\\/]([^?#]+)/);
  if (!match) return null;
  return `./${match[1]}/${match[2]}`;
}

export const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-caption'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.caption) return {};
          return { 'data-caption': attributes.caption };
        },
      },
      align: {
        default: 'center',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-align') || getDefaultAlignment(),
        renderHTML: (attributes: Record<string, any>) => ({
          'data-align': attributes.align || getDefaultAlignment(),
        }),
      },
      // Document-relative path (e.g. "./drawio/diagram-1.drawio.svg") as returned by the
      // backend when the image/diagram was created. Storing this avoids having to
      // reverse-engineer the path from the (possibly percent-encoded) asset.localhost src URL.
      relativePath: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-relative-path'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.relativePath) return {};
          return { 'data-relative-path': attributes.relativePath };
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
      wrapper.classList.add('image-node-wrapper');

      // -- Alignment toolbar (shown on image click) --
      const alignToolbar = document.createElement('div');
      alignToolbar.classList.add('image-align-toolbar');
      const alignDefs = [
        { value: 'left', label: '← Left' },
        { value: 'center', label: '↔ Center' },
        { value: 'right', label: 'Right →' },
      ];
      alignDefs.forEach(({ value, label }) => {
        const btn = document.createElement('button');
        btn.classList.add('image-align-btn');
        btn.textContent = label;
        btn.dataset.alignValue = value;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          applyAlign(value);
          alignToolbar.classList.remove('visible');
        });
        alignToolbar.appendChild(btn);
      });

      // -- Caption display (visible when not editing) --
      const captionDisplay = document.createElement('div');
      captionDisplay.classList.add('image-caption-display');
      captionDisplay.setAttribute('contenteditable', 'false');

      // -- Image container --
      const imageContainer = document.createElement('div');
      imageContainer.classList.add('image-container');

      const img = document.createElement('img');
      img.setAttribute('draggable', 'false');
      imageContainer.appendChild(img);

      // -- Caption input (visible only when editing) --
      const captionInputWrapper = document.createElement('div');
      captionInputWrapper.classList.add('caption-input-wrapper');
      captionInputWrapper.style.display = 'none';
      captionInputWrapper.setAttribute('contenteditable', 'false');

      const captionInput = document.createElement('input');
      captionInput.type = 'text';
      captionInput.classList.add('caption-input');
      captionInput.placeholder = 'Enter image caption...';
      captionInputWrapper.appendChild(captionInput);

      // Order: toolbar, image, then captions
      wrapper.appendChild(alignToolbar);
      wrapper.appendChild(imageContainer);
      wrapper.appendChild(captionDisplay);
      wrapper.appendChild(captionInputWrapper);

      // === Helper: update caption display ===
      function refreshCaption() {
        if (isEditingCaption) return;

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

      // === Helper: update image src and alt ===
      function refreshImage() {
        const src = currentNode.attrs.src || '';
        const alt = currentNode.attrs.alt || '';

        img.src = src;
        img.alt = alt;

        // Set title attribute to show filename and path on hover
        if (src) {
          const relativePath = currentNode.attrs.relativePath || extractRelativePathFromSrc(src);
          if (relativePath) {
            const fileName = relativePath.split('/').pop();
            img.title = `Filename: ${fileName}\nPath: ${relativePath}`;
          } else {
            img.title = src;
          }
        }

        if (!src) {
          img.style.display = 'none';
        } else {
          img.style.display = 'block';
        }
      }

      // === Helper: apply alignment to node ===
      function applyAlign(alignValue: string) {
        wrapper.dataset.align = alignValue;
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              align: alignValue,
            });
            editor.view.dispatch(tr);
            if ((window as any).__editorFlushUpdate) {
              (window as any).__editorFlushUpdate();
            }
          }
        }
      }

      // === Helper: refresh alignment toolbar state ===
      function refreshAlign() {
        const align = currentNode.attrs.align || 'center';
        wrapper.dataset.align = align;
        alignToolbar.querySelectorAll<HTMLButtonElement>('.image-align-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.alignValue === align);
        });
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
            if ((window as any).__editorFlushUpdate) {
              (window as any).__editorFlushUpdate();
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

        requestAnimationFrame(() => {
          captionInput.focus();
          captionInput.select();
        });
      });

      // === Image double-click → open draw.io files for editing ===
      img.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const src = currentNode.attrs.src || '';

        // Only handle draw.io files on double-click
        if (src.includes('.drawio.svg') || src.includes('/drawio/')) {
          // Prefer the relativePath node attribute (set on creation) over reverse-engineering
          // it from the (possibly percent-encoded) src URL.
          const drawioPath = currentNode.attrs.relativePath || extractRelativePathFromSrc(src) || src;

          // Ask the host app (Tauri or VS Code webview) to open the draw.io file externally
          const openDrawio = (window as any).__openDrawio;
          const vscode = (window as any).vscode;
          if (openDrawio) {
            openDrawio(drawioPath);
          } else if (vscode) {
            vscode.postMessage({
              type: 'openDrawio',
              drawioPath: drawioPath,
            });
          } else {
            console.error('No host bridge available to open Draw.io file');
          }
        }
        // Regular images: do nothing on double-click (use right-click context menu instead)
      });

      // === Image right-click → show context menu ===
      img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const src = currentNode.attrs.src || '';
        const alt = currentNode.attrs.alt || '';

        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            const showContextMenu = (window as any).__showImageContextMenu;
            if (showContextMenu) {
              showContextMenu(e.clientX, e.clientY, pos, src, alt);
            }
          }
        }
      });

      // Also handle double-click on the whole image container for better UX (draw.io only)
      imageContainer.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const src = currentNode.attrs.src || '';

        if (src.includes('.drawio.svg') || src.includes('/drawio/')) {
          const drawioPath = currentNode.attrs.relativePath || extractRelativePathFromSrc(src) || src;

          const openDrawio = (window as any).__openDrawio;
          const vscode = (window as any).vscode;
          if (openDrawio) {
            openDrawio(drawioPath);
          } else if (vscode) {
            vscode.postMessage({
              type: 'openDrawio',
              drawioPath: drawioPath,
            });
          }
        }
        // Regular images: do nothing on double-click (use right-click context menu instead)
      });

      // Also handle right-click on the whole image container
      imageContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const src = currentNode.attrs.src || '';
        const alt = currentNode.attrs.alt || '';

        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            const showContextMenu = (window as any).__showImageContextMenu;
            if (showContextMenu) {
              showContextMenu(e.clientX, e.clientY, pos, src, alt);
            }
          }
        }
      });

      // === Image click → show alignment toolbar ===
      imageContainer.addEventListener('click', () => {
        alignToolbar.classList.add('visible');
      });

      // Hide toolbar when clicking outside the wrapper
      const handleOutsideClick = (e: MouseEvent) => {
        if (!wrapper.contains(e.target as Node)) {
          alignToolbar.classList.remove('visible');
        }
      };
      document.addEventListener('click', handleOutsideClick);

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
        e.stopPropagation();
      });

      captionInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (isEditingCaption) {
            commitCaption();
          }
        }, 100);
      });

      // === Initial render ===
      refreshCaption();
      refreshImage();
      refreshAlign();

      // === NodeView interface ===
      return {
        dom: wrapper,

        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false;
          currentNode = updatedNode;
          refreshCaption();
          refreshImage();
          refreshAlign();
          return true;
        },

        ignoreMutation(mutation: MutationRecord | { type: 'selection' }) {
          if (mutation.type === 'selection') return false;
          const target = (mutation as MutationRecord).target;
          if (!target) return true;
          // Ignore mutations in caption area
          return wrapper.contains(target);
        },

        stopEvent(event: Event) {
          const target = event.target as HTMLElement;
          if (!target) return false;

          // Allow double-click events on image/image container to pass through
          if (event.type === 'dblclick') {
            // Let the event propagate so our custom handler can process it (for both draw.io and regular images)
            return false;
          }

          // Stop ProseMirror from handling events in caption/toolbar area
          if (alignToolbar.contains(target)) return true;
          return captionDisplay.contains(target) || captionInputWrapper.contains(target);
        },

        destroy() {
          document.removeEventListener('click', handleOutsideClick);
        },
      };
    };
  },
});
