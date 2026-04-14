import { Node } from '@tiptap/core';
import type { NodeView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';

export type CalloutVariant = 'note' | 'info' | 'tip' | 'warning' | 'danger';

export const CALLOUT_ICONS: Record<CalloutVariant, string> = {
  note: '📝',
  info: 'ℹ️',
  tip: '💡',
  warning: '⚠️',
  danger: '🚨',
};

export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
};

function createCalloutNodeView(
  node: PmNode,
  _view: unknown,
  _getPos: unknown,
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
  label.textContent = CALLOUT_LABELS[variant] ?? CALLOUT_LABELS.note;

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
      label.textContent = CALLOUT_LABELS[newVariant] ?? CALLOUT_LABELS.note;
      return true;
    },
  };
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

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
    return ({ node, view, getPos }) => createCalloutNodeView(node, view, getPos);
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
