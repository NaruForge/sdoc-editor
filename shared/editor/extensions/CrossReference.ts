import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Suggestion } from '@tiptap/suggestion';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { buildNumberingIndex } from '@shared/document/numbering';
import type { ResolvedEditorSettings, TiptapNode } from '@shared/types';
import { NOOP_EDITOR_EXTENSION_RUNTIME, type EditorExtensionOptions } from '../extensionRuntime';

export interface RefTarget {
  id: string;
  type: 'heading' | 'figure' | 'table' | 'equation';
  label: string;
  level?: number;
}

const crossRefPluginKey = new PluginKey('crossReference');
const crossRefSyncKey = new PluginKey('crossReferenceSync');

/** Dispatch this meta on any transaction to force CrossRef label re-sync */
export const CROSSREF_RESYNC_META = 'crossRefResync';

export const CrossReference = Extension.create<EditorExtensionOptions>({
  name: 'crossReference',

  addOptions() {
    return { runtime: NOOP_EDITOR_EXTENSION_RUNTIME };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const runtime = this.options.runtime;

    return [
      // Cross-reference text sync plugin
      new Plugin({
        key: crossRefSyncKey,
        appendTransaction(transactions, _oldState, newState) {
          const hasDocChange = transactions.some(tr => tr.docChanged);
          const hasResync = transactions.some(tr => tr.getMeta(CROSSREF_RESYNC_META));
          if (!hasDocChange && !hasResync) return null;

          const idMap = buildIdMap(newState.doc, runtime.getSettings());
          if (idMap.size === 0) return null;

          // Collect all changes first to avoid position-shifting issues
          const changes: Array<{
            pos: number;
            end: number;
            newLabel: string;
            mark: import('@tiptap/pm/model').Mark;
          }> = [];

          newState.doc.descendants((node, pos) => {
            if (node.isText && node.marks.length > 0) {
              const linkMark = node.marks.find(
                m => m.type.name === 'link' && m.attrs.href?.startsWith('#')
              );
              if (linkMark) {
                const targetId = (linkMark.attrs.href as string).slice(1);
                const newLabel = idMap.get(targetId);
                if (newLabel && node.text !== newLabel) {
                  changes.push({ pos, end: pos + node.nodeSize, newLabel, mark: linkMark });
                }
              }
            }
          });

          if (changes.length === 0) return null;

          let tr = newState.tr;
          // Apply back-to-front so earlier changes don't shift subsequent positions
          for (const change of changes.sort((a, b) => b.pos - a.pos)) {
            // Use replaceWith + explicit text node to guarantee mark preservation
            const textNode = newState.schema.text(change.newLabel, [change.mark]);
            tr = tr.replaceWith(change.pos, change.end, textNode);
          }
          return tr;
        },
      }),

      Suggestion<RefTarget, RefTarget>({
        editor,
        pluginKey: crossRefPluginKey,
        char: '@',
        allowSpaces: true,
        allowedPrefixes: null,

        items: ({ query, editor }) => {
          const targets = collectTargets(editor, runtime.getSettings());
          if (!query) return targets;
          const q = query.toLowerCase();
          return targets.filter(t => t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
        },

        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: 'text',
                marks: [{ type: 'link', attrs: { href: `#${props.id}` } }],
                text: props.label,
              },
              {
                type: 'text',
                text: ' ',
              },
            ])
            .run();
        },

        render: () => {
          let popup: HTMLElement | null = null;
          let selectedIndex = 0;
          let currentItems: RefTarget[] = [];
          let currentCommand: ((props: RefTarget) => void) | null = null;

          const destroy = () => {
            if (popup) {
              popup.remove();
              popup = null;
            }
          };

          const renderList = () => {
            if (!popup) return;
            popup.innerHTML = '';

            const groups: Record<string, RefTarget[]> = {};
            for (const t of currentItems) {
              const cat = t.type === 'heading' ? 'Headings' : t.type === 'figure' ? 'Figures' : t.type === 'table' ? 'Tables' : 'Equations';
              (groups[cat] ??= []).push(t);
            }

            let flatIndex = 0;
            for (const [cat, items] of Object.entries(groups)) {
              const header = document.createElement('div');
              header.className = 'crossref-category';
              header.textContent = cat;
              popup.appendChild(header);

              for (const item of items) {
                const el = document.createElement('div');
                el.className = 'crossref-item' + (flatIndex === selectedIndex ? ' focused' : '');
                el.dataset.index = String(flatIndex);

                const icon = document.createElement('span');
                icon.className = 'crossref-icon';
                icon.textContent = item.type === 'heading' ? '§' : item.type === 'figure' ? '🖼' : item.type === 'table' ? '▦' : '∑';
                el.appendChild(icon);

                const label = document.createElement('span');
                label.className = 'crossref-label';
                label.textContent = item.label;
                el.appendChild(label);

                el.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  currentCommand?.(item);
                });

                popup.appendChild(el);
                flatIndex++;
              }
            }
          };

          return {
            onStart(props: SuggestionProps<RefTarget, RefTarget>) {
              currentItems = props.items;
              currentCommand = props.command;
              selectedIndex = 0;

              if (currentItems.length === 0) return;

              popup = document.createElement('div');
              popup.className = 'crossref-popup';
              document.body.appendChild(popup);

              renderList();
              positionPopup(popup, props.clientRect);
            },

            onUpdate(props: SuggestionProps<RefTarget, RefTarget>) {
              currentItems = props.items;
              currentCommand = props.command;
              selectedIndex = 0;

              if (currentItems.length === 0) {
                destroy();
                return;
              }

              if (!popup) {
                popup = document.createElement('div');
                popup.className = 'crossref-popup';
                document.body.appendChild(popup);
              }

              renderList();
              positionPopup(popup, props.clientRect);
            },

            onKeyDown(props: SuggestionKeyDownProps) {
              const { event } = props;

              if (event.key === 'Escape') {
                destroy();
                return true;
              }

              if (event.key === 'ArrowDown') {
                selectedIndex = Math.min(selectedIndex + 1, currentItems.length - 1);
                renderList();
                popup?.querySelector('.crossref-item.focused')?.scrollIntoView({ block: 'nearest' });
                return true;
              }

              if (event.key === 'ArrowUp') {
                selectedIndex = Math.max(selectedIndex - 1, 0);
                renderList();
                popup?.querySelector('.crossref-item.focused')?.scrollIntoView({ block: 'nearest' });
                return true;
              }

              if (event.key === 'Enter') {
                if (currentItems[selectedIndex]) {
                  currentCommand?.(currentItems[selectedIndex]);
                }
                return true;
              }

              return false;
            },

            onExit() {
              destroy();
            },
          };
        },
      }),
    ];
  },
});

function positionPopup(popup: HTMLElement, clientRect?: (() => DOMRect | null) | null) {
  if (!clientRect) return;
  const rect = clientRect();
  if (!rect) return;

  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 4}px`;

  requestAnimationFrame(() => {
    if (!popup) return;
    const pr = popup.getBoundingClientRect();
    if (pr.bottom > window.innerHeight) {
      popup.style.top = `${rect.top - pr.height - 4}px`;
    }
    if (pr.right > window.innerWidth) {
      popup.style.left = `${window.innerWidth - pr.width - 8}px`;
    }
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s가-힣-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled';
}

export function collectTargets(editor: Editor, settings: ResolvedEditorSettings): RefTarget[] {
  const index = buildNumberingIndex(editor.getJSON() as TiptapNode, settings);
  return index.entries.flatMap((entry): RefTarget[] => entry.id ? [{
    id: entry.id,
    type: entry.kind,
    label: entry.referenceLabel,
    ...(entry.headingLevel ? { level: entry.headingLevel } : {}),
  }] : []);
}

/**
 * Build id → label map from a ProseMirror doc Node.
 * Uses existing id attribute OR falls back to the same slug logic as collectTargets,
 * because the webview never receives server-assigned IDs (suppressed by pendingApplyEdits).
 */
function buildIdMap(
  doc: import('@tiptap/pm/model').Node,
  settings: ResolvedEditorSettings,
): Map<string, string> {
  const index = buildNumberingIndex(doc.toJSON() as TiptapNode, settings);
  return new Map([...index.byId].map(([id, entry]) => [id, entry.referenceLabel]));
}
