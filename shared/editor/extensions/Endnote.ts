import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  getDocumentStructureIndexState,
  subscribeToDocumentStructureIndex,
  type DocumentStructureIndex,
} from '../structureIndex';
import { NOOP_EDITOR_EXTENSION_RUNTIME, type EditorExtensionOptions } from '../extensionRuntime';

export interface EndnoteAttributes {
  id?: string;
  body?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    endnote: {
      insertEndnote: (attributes?: EndnoteAttributes) => ReturnType;
    };
  }
}

const endnoteIds = (doc: ProseMirrorNode): Set<string> => {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'endnote' && typeof node.attrs.id === 'string') ids.add(node.attrs.id);
  });
  return ids;
};

export function nextEndnoteId(doc: ProseMirrorNode): string {
  const ids = endnoteIds(doc);
  let number = 1;
  while (ids.has(`endnote-${number}`)) number += 1;
  return `endnote-${number}`;
}

export function focusEndnoteBody(id: string): void {
  const focus = () => {
    const target = document.getElementById(`endnote-editor-edit-${id}`)
      ?? document.getElementById(`endnote-editor-${id}`);
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus();
    return true;
  };
  requestAnimationFrame(() => {
    if (!focus()) requestAnimationFrame(focus);
  });
}

export function beginEndnoteBodyEdit(id: string): void {
  const begin = () => {
    const trigger = document.getElementById(`endnote-editor-edit-${id}`);
    if (!(trigger instanceof HTMLButtonElement)) return false;
    trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
    trigger.click();
    return true;
  };
  requestAnimationFrame(() => {
    if (!begin()) requestAnimationFrame(begin);
  });
}

export function insertEndnoteAndFocus(editor: Editor): boolean {
  const id = nextEndnoteId(editor.state.doc);
  const inserted = editor.chain().focus().insertEndnote({ id, body: '' }).run();
  if (inserted) beginEndnoteBodyEdit(id);
  return inserted;
}

type NumberedEndnoteDom = HTMLElement & { _setEndnoteNumber?: (number: string) => void };

export const Endnote = Node.create<EditorExtensionOptions>({
  name: 'endnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },

  addAttributes() {
    return {
      id: { default: null },
      body: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-endnote-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-endnote-id': HTMLAttributes.id }), 0];
  },

  addNodeView() {
    const runtime = this.options.runtime;
    return ({ node }) => {
      let currentId = String(node.attrs.id ?? '');
      const dom = document.createElement('sup') as NumberedEndnoteDom;
      dom.className = 'endnote-marker';
      dom.setAttribute('contenteditable', 'false');
      dom.dataset.endnoteId = currentId;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'endnote-marker__button';
      button.textContent = '?';
      button.setAttribute('aria-label', runtime.translate('endnote.marker', { number: '?' }));
      button.id = `endnote-editor-ref-${currentId}`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        focusEndnoteBody(currentId);
      });
      dom.appendChild(button);

      dom._setEndnoteNumber = (number) => {
        button.textContent = number;
        button.setAttribute('aria-label', runtime.translate('endnote.marker', { number }));
      };

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'endnote') return false;
          currentId = String(updatedNode.attrs.id ?? '');
          dom.dataset.endnoteId = currentId;
          button.id = `endnote-editor-ref-${currentId}`;
          return true;
        },
        stopEvent: () => true,
      };
    };
  },

  addCommands() {
    return {
      insertEndnote: (attributes = {}) => ({ state, commands }) => commands.insertContent({
        type: this.name,
        attrs: {
          id: attributes.id ?? nextEndnoteId(state.doc),
          body: (attributes.body ?? '').replace(/[\r\n]+/g, ' '),
        },
      }),
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      view(view) {
        const applyNumbering = (index: DocumentStructureIndex) => {
          for (const entry of index.endnotes) {
            const dom = view.nodeDOM(entry.pos) as NumberedEndnoteDom | null;
            dom?._setEndnoteNumber?.(entry.number);
          }
        };
        applyNumbering(getDocumentStructureIndexState(view.state));
        const unsubscribe = subscribeToDocumentStructureIndex(view, applyNumbering);
        return { destroy: unsubscribe };
      },
    })];
  },
});
