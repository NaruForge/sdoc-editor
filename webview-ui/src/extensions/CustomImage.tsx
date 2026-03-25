import Image from '@tiptap/extension-image';

export const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-caption': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-caption'),
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes['data-caption']) return {};
          return { 'data-caption': attributes['data-caption'] };
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

      // Order: image first, then captions
      wrapper.appendChild(imageContainer);
      wrapper.appendChild(captionDisplay);
      wrapper.appendChild(captionInputWrapper);

      // === Helper: update caption display ===
      function refreshCaption() {
        if (isEditingCaption) return;

        const cap = currentNode.attrs['data-caption'];
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
          const match = src.match(/images\/([^?#]+)/);
          if (match) {
            img.title = `Filename: ${match[1]}\nPath: ./images/${match[1]}`;
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
                'data-caption': newValue,
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
        captionInput.value = currentNode.attrs['data-caption'] || '';

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
          // Extract relative path from src
          let drawioPath = src;
          
          // If it's a webview URI, extract the relative path
          const drawioMatch = src.match(/drawio\/([^?#]+)/);
          if (drawioMatch) {
            drawioPath = `./drawio/${drawioMatch[1]}`;
          }

          // Send message to VS Code to open the draw.io file
          const vscode = (window as any).vscode;
          if (vscode) {
            console.log('Opening draw.io file:', drawioPath);
            vscode.postMessage({
              type: 'openDrawio',
              drawioPath: drawioPath,
            });
          } else {
            console.error('VS Code API not available');
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
          let drawioPath = src;
          const drawioMatch = src.match(/drawio\/([^?#]+)/);
          if (drawioMatch) {
            drawioPath = `./drawio/${drawioMatch[1]}`;
          }

          const vscode = (window as any).vscode;
          if (vscode) {
            console.log('Opening draw.io file from container:', drawioPath);
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

      // === NodeView interface ===
      return {
        dom: wrapper,

        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false;
          currentNode = updatedNode;
          refreshCaption();
          refreshImage();
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
          
          // Stop ProseMirror from handling events in caption area
          return captionDisplay.contains(target) || captionInputWrapper.contains(target);
        },

        destroy() {},
      };
    };
  },
});
