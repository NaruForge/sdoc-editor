import React, { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { type Editor, useEditorState } from '@tiptap/react';
import { useEditorI18n } from '../i18n';

interface EndnoteListProps {
  editor: Editor;
}

export interface EndnoteViewItem {
  id: string;
  body: string;
  number: number;
}

interface EndnoteListItemProps {
  note: EndnoteViewItem;
  editable: boolean;
  editing: boolean;
  draft: string;
  onBeginEdit: () => void;
  onDraftChange: (draft: string) => void;
  onCommit: (restoreFocus?: boolean) => void;
  onCancel: () => void;
  onReturnToMarker: () => void;
}

export const normalizeEndnoteDraft = (body: string): string => body.replace(/[\r\n]+/g, ' ');

export const activateEndnoteReturn = (
  editing: boolean,
  commit: () => void,
  returnToMarker: () => void,
): void => {
  if (editing) commit();
  returnToMarker();
};

export const EndnoteListItem: React.FC<EndnoteListItemProps> = ({
  note,
  editable,
  editing,
  draft,
  onBeginEdit,
  onDraftChange,
  onCommit,
  onCancel,
  onReturnToMarker,
}) => {
  const { t } = useEditorI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  return (
    <li id={`endnote-editor-item-${note.id}`}>
      <button
        type="button"
        className="endnote-list__number"
        aria-label={t('endnote.return', { number: note.number })}
        title={t('endnote.return', { number: note.number })}
        onClick={() => activateEndnoteReturn(editing, onCommit, onReturnToMarker)}
      >{note.number}</button>
      <div className="endnote-list__body">
        {editing ? (
          <>
            <input
              ref={inputRef}
              id={`endnote-editor-${note.id}`}
              type="text"
              value={draft}
              aria-label={t('endnote.bodyLabel', { number: note.number })}
              placeholder={t('endnote.empty')}
              onChange={(event) => onDraftChange(normalizeEndnoteDraft(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onCommit(true);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancel();
                }
              }}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.closest('li')?.contains(next)) return;
                onCommit();
              }}
            />
            <span className="endnote-list__edit-actions">
              <button
                type="button"
                className="endnote-list__action"
                aria-label={t('endnote.save', { number: note.number })}
                title={t('endnote.save', { number: note.number })}
                onClick={() => onCommit(true)}
              >
                <Check size={14} aria-hidden="true" />
                <span>{t('common.save')}</span>
              </button>
              <button
                type="button"
                className="endnote-list__action"
                aria-label={t('endnote.cancel', { number: note.number })}
                title={t('endnote.cancel', { number: note.number })}
                onClick={onCancel}
              >
                <X size={14} aria-hidden="true" />
                <span>{t('common.cancel')}</span>
              </button>
            </span>
          </>
        ) : (
          <span
            className={`endnote-list__text${note.body ? '' : ' endnote-list__text--empty'}`}
            id={`endnote-editor-${note.id}`}
            tabIndex={editable ? undefined : -1}
          >
            {note.body || t('endnote.empty')}
          </span>
        )}
      </div>
      {editable && !editing && (
        <span className="endnote-list__row-actions">
          <button
            id={`endnote-editor-edit-${note.id}`}
            type="button"
            className="endnote-list__action endnote-list__edit"
            aria-label={t('endnote.edit', { number: note.number })}
            title={t('endnote.edit', { number: note.number })}
            onClick={onBeginEdit}
          >
            <Pencil size={14} aria-hidden="true" />
            <span>{t('common.edit')}</span>
          </button>
        </span>
      )}
    </li>
  );
};

export const EndnoteList: React.FC<EndnoteListProps> = ({ editor }) => {
  const { t } = useEditorI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const viewState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }): { items: EndnoteViewItem[]; editable: boolean } => {
      const items: EndnoteViewItem[] = [];
      currentEditor.state.doc.descendants((node) => {
        if (node.type.name !== 'endnote' || typeof node.attrs.id !== 'string') return;
        items.push({
          id: node.attrs.id,
          body: typeof node.attrs.body === 'string' ? node.attrs.body : '',
          number: items.length + 1,
        });
      });
      return { items, editable: currentEditor.isEditable };
    },
  });
  const endnotes = viewState.items;

  useEffect(() => {
    if (editingId && !endnotes.some((note) => note.id === editingId)) setEditingId(null);
  }, [editingId, endnotes]);

  if (endnotes.length === 0) return null;

  const updateBody = (id: string, body: string) => {
    const transaction = editor.state.tr;
    let changed = false;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'endnote' || node.attrs.id !== id) return;
      transaction.setNodeMarkup(pos, undefined, { ...node.attrs, body: normalizeEndnoteDraft(body) });
      changed = true;
      return false;
    });
    if (changed) editor.view.dispatch(transaction);
  };

  const restoreEditFocus = (id: string) => {
    requestAnimationFrame(() => document.getElementById(`endnote-editor-edit-${id}`)?.focus());
  };

  const commit = (id: string, restoreFocus = false) => {
    updateBody(id, draft);
    setEditingId(null);
    if (restoreFocus) restoreEditFocus(id);
  };

  const cancel = (id: string) => {
    setEditingId(null);
    restoreEditFocus(id);
  };

  const returnToMarker = (id: string) => {
    const marker = document.getElementById(`endnote-editor-ref-${id}`);
    marker?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    marker?.focus();
  };

  return (
    <section className="endnote-list" aria-labelledby="endnote-list-heading">
      <hr />
      <h2 id="endnote-list-heading">{t('endnote.heading')}</h2>
      <ol>
        {endnotes.map((note) => (
          <EndnoteListItem
            key={note.id}
            note={note}
            editable={viewState.editable}
            editing={editingId === note.id}
            draft={editingId === note.id ? draft : note.body}
            onBeginEdit={() => {
              setDraft(note.body);
              setEditingId(note.id);
            }}
            onDraftChange={setDraft}
            onCommit={(restoreFocus) => commit(note.id, restoreFocus)}
            onCancel={() => cancel(note.id)}
            onReturnToMarker={() => returnToMarker(note.id)}
          />
        ))}
      </ol>
    </section>
  );
};
