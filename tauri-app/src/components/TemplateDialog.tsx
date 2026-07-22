import React, { useEffect, useMemo, useState } from 'react';
import type { SdocTemplate } from '@shared/template';
import { suggestTemplateFileName } from '../templateService';

interface TemplateDialogProps {
  templates: SdocTemplate[];
  diagnostics: string[];
  loading: boolean;
  error?: string;
  workspaceMode: boolean;
  onConfirm: (template: SdocTemplate, title: string, fileName?: string) => void;
  onCancel: () => void;
}

export const TemplateDialog: React.FC<TemplateDialogProps> = ({
  templates,
  diagnostics,
  loading,
  error,
  workspaceMode,
  onConfirm,
  onCancel,
}) => {
  const [selectedId, setSelectedId] = useState('builtin:blank');
  const [title, setTitle] = useState('');
  const [fileName, setFileName] = useState('untitled.sdoc');
  const [fileNameEdited, setFileNameEdited] = useState(false);
  const selected = useMemo(
    () => templates.find((template) => template.descriptor.id === selectedId) ?? templates[0],
    [selectedId, templates],
  );

  useEffect(() => {
    if (!fileNameEdited) setFileName(suggestTemplateFileName(title));
  }, [fileNameEdited, title]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const normalizedTitle = title.trim();
  const validTitle = normalizedTitle.length >= 1 && normalizedTitle.length <= 200;
  const validFileName = !workspaceMode || (
    fileName.trim().toLowerCase().endsWith('.sdoc')
    && !/[\\/]/.test(fileName)
    && !fileName.includes('..')
  );

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-content--lg template-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>새 SDOC 문서 · 실험적 템플릿</h3>
            <p>템플릿 기능은 실험적입니다. 문서 구조에 맞는 템플릿을 선택하세요.</p>
          </div>
          <button type="button" className="modal-close" aria-label="닫기" onClick={onCancel}>×</button>
        </div>
        <div className="template-dialog-body">
          <section className="template-dialog-list" aria-label="문서 템플릿">
            {loading && <p className="template-dialog-status">템플릿을 불러오는 중…</p>}
            {!loading && templates.map((template) => (
              <button
                type="button"
                key={template.descriptor.id}
                className={`template-dialog-item${selected?.descriptor.id === template.descriptor.id ? ' is-selected' : ''}`}
                onClick={() => setSelectedId(template.descriptor.id)}
              >
                <strong>{template.descriptor.name}</strong>
                <span>{template.descriptor.sourceLabel}</span>
                {template.descriptor.description && <small>{template.descriptor.description}</small>}
              </button>
            ))}
          </section>
          <section className="template-dialog-fields">
            {selected && (
              <div className="template-dialog-summary">
                <strong>{selected.descriptor.name}</strong>
                <span>{selected.descriptor.sourceLabel}</span>
                <p>{selected.descriptor.description ?? '선택한 구조로 새 문서를 만듭니다.'}</p>
              </div>
            )}
            <label>
              문서 제목
              <input
                autoFocus
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="문서 제목을 입력하세요"
              />
            </label>
            {workspaceMode && (
              <label>
                파일 이름
                <input
                  value={fileName}
                  onChange={(event) => {
                    setFileNameEdited(true);
                    setFileName(event.target.value);
                  }}
                />
              </label>
            )}
            {error && <p className="template-dialog-error" role="alert">{error}</p>}
            {diagnostics.length > 0 && (
              <details className="template-dialog-diagnostics">
                <summary>사용할 수 없는 템플릿 {diagnostics.length}개</summary>
                <ul>{diagnostics.map((diagnostic, index) => <li key={`${index}-${diagnostic}`}>{diagnostic}</li>)}</ul>
              </details>
            )}
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>취소</button>
          <button
            type="button"
            className="btn-primary"
            disabled={loading || !selected || !validTitle || !validFileName}
            onClick={() => selected && onConfirm(selected, normalizedTitle, workspaceMode ? fileName.trim() : undefined)}
          >
            만들기
          </button>
        </div>
      </div>
    </div>
  );
};
