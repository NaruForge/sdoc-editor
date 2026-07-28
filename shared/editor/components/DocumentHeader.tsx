import React, { useRef, useState } from 'react';
import { User, Calendar, Clock, Tag, Info } from 'lucide-react';
import { useEditorI18n } from '../i18n';

interface DocumentHeaderProps {
  author: string;
  version: string;
  created: string;
  modified: string;
  onAuthorChange: (value: string) => void;
  onVersionChange: (value: string) => void;
}

export const DocumentHeader: React.FC<DocumentHeaderProps> = ({
  author,
  version,
  created,
  modified,
  onAuthorChange,
  onVersionChange,
}) => {
  const { t, formatDate } = useEditorI18n();
  const [editingAuthor, setEditingAuthor] = useState(false);
  const [authorDraft, setAuthorDraft] = useState('');
  const [editingVersion, setEditingVersion] = useState(false);
  const [versionDraft, setVersionDraft] = useState('');
  const authorButtonRef = useRef<HTMLButtonElement>(null);
  const versionButtonRef = useRef<HTMLButtonElement>(null);

  const handleAuthorClick = () => {
    setAuthorDraft(author);
    setEditingAuthor(true);
  };

  const handleAuthorCommit = (restoreFocus = false) => {
    setEditingAuthor(false);
    if (authorDraft !== author) {
      onAuthorChange(authorDraft);
    }
    if (restoreFocus) requestAnimationFrame(() => authorButtonRef.current?.focus());
  };

  const handleAuthorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAuthorCommit(true);
    if (e.key === 'Escape') {
      setEditingAuthor(false);
      requestAnimationFrame(() => authorButtonRef.current?.focus());
    }
  };

  const handleVersionClick = () => {
    setVersionDraft(version);
    setEditingVersion(true);
  };

  const handleVersionCommit = (restoreFocus = false) => {
    setEditingVersion(false);
    if (versionDraft !== version) {
      onVersionChange(versionDraft);
    }
    if (restoreFocus) requestAnimationFrame(() => versionButtonRef.current?.focus());
  };

  const handleVersionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleVersionCommit(true);
    if (e.key === 'Escape') {
      setEditingVersion(false);
      requestAnimationFrame(() => versionButtonRef.current?.focus());
    }
  };

  const timestamps = (
    <>
      <div className="document-header-field" title={t('document.created')}>
        <Calendar size={14} aria-hidden="true" />
        <span className="document-header-value">{formatDate(created)}</span>
      </div>
      <div className="document-header-field" title={t('document.modified')}>
        <Clock size={14} aria-hidden="true" />
        <span className="document-header-value">{formatDate(modified)}</span>
      </div>
    </>
  );

  return (
    <div className="document-header">
      <div className="document-header-meta">
        <div className="document-header-field" title={t('document.author')}>
          <User size={14} aria-hidden="true" />
          {editingAuthor ? (
            <input
              className="document-header-input"
              value={authorDraft}
              onChange={(e) => setAuthorDraft(e.target.value)}
              aria-label={t('document.author')}
              onBlur={() => handleAuthorCommit(false)}
              onKeyDown={handleAuthorKeyDown}
              placeholder={t('document.authorPlaceholder')}
              autoFocus
            />
          ) : (
            <button
              ref={authorButtonRef}
              type="button"
              className={`document-header-value editable ${!author ? 'placeholder' : ''}`}
              onClick={handleAuthorClick}
              aria-label={author || t('document.authorUnset')}
            >
              {author || t('document.authorUnset')}
            </button>
          )}
        </div>
        <div className="document-header-field" title={t('document.version')}>
          <Tag size={14} aria-hidden="true" />
          {editingVersion ? (
            <input
              className="document-header-input"
              style={{ width: '80px' }}
              value={versionDraft}
              onChange={(e) => setVersionDraft(e.target.value)}
              aria-label={t('document.version')}
              onBlur={() => handleVersionCommit(false)}
              onKeyDown={handleVersionKeyDown}
              placeholder={t('document.versionPlaceholder')}
              autoFocus
            />
          ) : (
            <button
              ref={versionButtonRef}
              type="button"
              className={`document-header-value editable ${!version ? 'placeholder' : ''}`}
              onClick={handleVersionClick}
              aria-label={version ? `${t('document.version')} ${version}` : t('document.versionUnset')}
            >
              {version ? `v${version}` : t('document.versionUnset')}
            </button>
          )}
        </div>
        <div className="document-header-timestamps">
          {timestamps}
        </div>
        <details className="document-header-info">
          <summary aria-label={t('document.info')}>
            <Info size={14} aria-hidden="true" />
            <span>{t('document.info')}</span>
          </summary>
          <div className="document-header-info-popover">{timestamps}</div>
        </details>
      </div>
    </div>
  );
};
