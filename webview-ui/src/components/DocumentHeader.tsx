import React, { useState } from 'react';
import { User, Calendar, Clock, Tag } from 'lucide-react';

interface DocumentHeaderProps {
  title: string;
  author: string;
  version: string;
  created: string;
  modified: string;
  onTitleChange: (value: string) => void;
  onAuthorChange: (value: string) => void;
  onVersionChange: (value: string) => void;
}

export const DocumentHeader: React.FC<DocumentHeaderProps> = ({
  title,
  author,
  version,
  created,
  modified,
  onTitleChange,
  onAuthorChange,
  onVersionChange,
}) => {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingAuthor, setEditingAuthor] = useState(false);
  const [authorDraft, setAuthorDraft] = useState('');
  const [editingVersion, setEditingVersion] = useState(false);
  const [versionDraft, setVersionDraft] = useState('');

  const formatDate = (iso: string): string => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const handleAuthorClick = () => {
    setAuthorDraft(author);
    setEditingAuthor(true);
  };

  const handleAuthorCommit = () => {
    setEditingAuthor(false);
    if (authorDraft !== author) {
      onAuthorChange(authorDraft);
    }
  };

  const handleAuthorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAuthorCommit();
    if (e.key === 'Escape') setEditingAuthor(false);
  };

  const handleVersionClick = () => {
    setVersionDraft(version);
    setEditingVersion(true);
  };

  const handleVersionCommit = () => {
    setEditingVersion(false);
    if (versionDraft !== version) {
      onVersionChange(versionDraft);
    }
  };

  const handleVersionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleVersionCommit();
    if (e.key === 'Escape') setEditingVersion(false);
  };

  return (
    <div className="document-header">
      <div className="document-header-title">
        {editingTitle ? (
          <input
            className="document-header-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              setEditingTitle(false);
              if (titleDraft !== title) onTitleChange(titleDraft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setEditingTitle(false);
                if (titleDraft !== title) onTitleChange(titleDraft);
              }
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            placeholder="Enter document title"
            autoFocus
          />
        ) : (
          <span
            className={`document-header-title-text ${!title ? 'placeholder' : ''}`}
            onClick={() => { setTitleDraft(title); setEditingTitle(true); }}
          >
            {title || 'Click to set title'}
          </span>
        )}
      </div>
      <div className="document-header-meta">
        <div className="document-header-field" title="Author">
          <User size={14} />
          {editingAuthor ? (
            <input
              className="document-header-input"
              value={authorDraft}
              onChange={(e) => setAuthorDraft(e.target.value)}
              onBlur={handleAuthorCommit}
              onKeyDown={handleAuthorKeyDown}
              placeholder="Enter author name"
              autoFocus
            />
          ) : (
            <span
              className={`document-header-value editable ${!author ? 'placeholder' : ''}`}
              onClick={handleAuthorClick}
            >
              {author || 'Click to set author'}
            </span>
          )}
        </div>
        <div className="document-header-field" title="Version">
          <Tag size={14} />
          {editingVersion ? (
            <input
              className="document-header-input"
              style={{ width: '80px' }}
              value={versionDraft}
              onChange={(e) => setVersionDraft(e.target.value)}
              onBlur={handleVersionCommit}
              onKeyDown={handleVersionKeyDown}
              placeholder="e.g. 1.0"
              autoFocus
            />
          ) : (
            <span
              className={`document-header-value editable ${!version ? 'placeholder' : ''}`}
              onClick={handleVersionClick}
            >
              {version ? `v${version}` : 'Set version'}
            </span>
          )}
        </div>
        <div className="document-header-field" title="Created">
          <Calendar size={14} />
          <span className="document-header-value">{formatDate(created)}</span>
        </div>
        <div className="document-header-field" title="Modified">
          <Clock size={14} />
          <span className="document-header-value">{formatDate(modified)}</span>
        </div>
      </div>
    </div>
  );
};
