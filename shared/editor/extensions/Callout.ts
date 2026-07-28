import { Node } from '@tiptap/core';
import type { NodeView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorExtensionOptions } from '../extensionRuntime';
import { NOOP_EDITOR_EXTENSION_RUNTIME } from '../extensionRuntime';
import type { EditorTranslationKey } from '../i18n';

export type CalloutVariant = 'note' | 'info' | 'tip' | 'warning' | 'danger';

export const CALLOUT_ICONS: Record<CalloutVariant, string> = {
  note: '📝',
  info: 'ℹ️',
  tip: '💡',
  warning: '⚠️',
  danger: '🚨',
};

const CALLOUT_LABEL_KEYS: Record<CalloutVariant, EditorTranslationKey> = {
  note: 'callout.note',
  info: 'callout.info',
  tip: 'callout.tip',
  warning: 'callout.warning',
  danger: 'callout.danger',
};

function createCalloutNodeView(
  node: PmNode,
  _view: unknown,
  _getPos: unknown,
  options: EditorExtensionOptions,
): NodeView {
  const variant: CalloutVariant = (node.attrs.variant as CalloutVariant) || 'note';

  const outer = document.createElement('div');
  outer.classList.add('callout-block');
  outer.setAttribute('data-type', 'callout');
  outer.setAttribute('data-variant', variant);

  const header = document.createElement('div');
  header.classList.add('callout-header');
  header.setAttribute('contenteditable', 'false');

  const icon = document.createElement('span');
  icon.classList.add('callout-icon');
  icon.textContent = CALLOUT_ICONS[variant] ?? CALLOUT_ICONS.note;

  const label = document.createElement('span');
  label.classList.add('callout-label');
  label.textContent = options.runtime.translate(CALLOUT_LABEL_KEYS[variant]);

  header.appendChild(icon);
  header.appendChild(label);

  const content = document.createElement('div');
  content.classList.add('callout-content');

  outer.appendChild(header);
  outer.appendChild(content);

  return {
    dom: outer,
    contentDOM: content,
    update(updatedNode: PmNode) {
      if (updatedNode.type !== node.type) return false;
      const newVariant: CalloutVariant = (updatedNode.attrs.variant as CalloutVariant) || 'note';
      outer.setAttribute('data-variant', newVariant);
      icon.textContent = CALLOUT_ICONS[newVariant] ?? CALLOUT_ICONS.note;
      label.textContent = options.runtime.translate(CALLOUT_LABEL_KEYS[newVariant]);
      return true;
    },
  };
}

export const Callout = Node.create<EditorExtensionOptions>({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },

  addAttributes() {
    return {
      variant: {
        default: 'note' as CalloutVariant,
        parseHTML: (element) => (element.getAttribute('data-variant') as CalloutVariant) || 'note',
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          return { variant: (el.getAttribute('data-variant') as CalloutVariant) || 'note' };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'callout', ...HTMLAttributes }, 0];
  },

  addNodeView() {
    const options = this.options;
    return ({ node, view, getPos }) => createCalloutNodeView(node, view, getPos, options);
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': ({ editor }) => {
        if (!editor.isActive('callout')) return false;
        return editor.chain().focus().insertContentAt(editor.state.selection.$to.after(), { type: 'paragraph' }).run();
      },
    };
  },
});
