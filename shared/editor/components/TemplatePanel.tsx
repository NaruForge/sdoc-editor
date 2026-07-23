import React, { useMemo, useState } from 'react';
import { FolderOpen, LayoutTemplate, RefreshCw, Save } from 'lucide-react';
import type { ManagedTemplateDescriptor } from '../../types/messages';
import type { TemplateSource } from '../../template';
import { PanelEmptyState } from './PanelEmptyState';

type TemplateFilter = 'all' | TemplateSource;

interface TemplatePanelProps {
  templates: readonly ManagedTemplateDescriptor[];
  isApplying: boolean;
  isManaging: boolean;
  isLoading?: boolean;
  diagnosticCount?: number;
  personalRootPath: string;
  personalRootScope: 'local' | 'remote';
  onApply: (templateId: string) => void;
  onRefresh: () => void;
  onSaveCurrent: () => void;
  onEdit: (template: ManagedTemplateDescriptor) => void;
  onDuplicate: (template: ManagedTemplateDescriptor) => void;
  onDelete: (template: ManagedTemplateDescriptor) => void;
  onOpenPersonalFolder: () => void;
}

const sourceLabel = (source: TemplateSource): string => {
  if (source === 'builtin') return '내장';
  if (source === 'workspace') return '작업공간';
  return '내 템플릿';
};

const FILTERS: ReadonlyArray<{ id: TemplateFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'builtin', label: '내장' },
  { id: 'workspace', label: '작업공간' },
  { id: 'user', label: '내 템플릿' },
];

export const TemplatePanel: React.FC<TemplatePanelProps> = ({
  templates,
  isApplying,
  isManaging,
  isLoading = false,
  diagnosticCount = 0,
  personalRootPath,
  personalRootScope,
  onApply,
  onRefresh,
  onSaveCurrent,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenPersonalFolder,
}) => {
  const [filter, setFilter] = useState<TemplateFilter>('all');
  const [previewId, setPreviewId] = useState<string>();
  const visibleTemplates = useMemo(
    () => filter === 'all' ? templates : templates.filter((template) => template.source === filter),
    [filter, templates],
  );
  const busy = isApplying || isManaging || isLoading;

  return (
    <section className="template-panel" aria-labelledby="template-panel-title">
      <div className="template-panel-header">
        <div id="template-panel-title" className="side-panel-section-title">문서 템플릿</div>
        <button
          type="button"
          className="template-panel-refresh"
          onClick={onRefresh}
          disabled={busy}
          aria-label="템플릿 목록 새로 고침"
          title="템플릿 목록 새로 고침"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="side-panel-section-desc">
        템플릿은 사용자가 선택할 때만 현재 문서에 적용됩니다.
      </p>
      <div className="template-personal-actions">
        <button type="button" onClick={onSaveCurrent} disabled={busy}>
          <Save size={13} aria-hidden="true" />
          현재 문서를 내 템플릿으로 저장
        </button>
        <button
          type="button"
          onClick={onOpenPersonalFolder}
          disabled={isManaging}
          title={personalRootPath}
        >
          <FolderOpen size={13} aria-hidden="true" />
          개인 템플릿 폴더 열기
        </button>
      </div>
      <p className="template-personal-location" title={personalRootPath}>
        {personalRootScope === 'remote' ? '원격 Extension Host 저장소' : '이 PC의 공유 저장소'} · {personalRootPath}
      </p>
      <div className="template-filter" role="group" aria-label="템플릿 출처 필터">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {diagnosticCount > 0 && (
        <p className="template-panel-diagnostic" role="status">
          불러오지 못한 템플릿 {diagnosticCount}개가 있습니다.
        </p>
      )}
      {visibleTemplates.length === 0 ? (
        <PanelEmptyState
          icon={<LayoutTemplate size={22} />}
          title={isLoading ? '템플릿을 불러오는 중입니다' : '해당하는 템플릿이 없습니다'}
          message="개인 템플릿을 저장하거나 작업공간의 .sdoc/templates 폴더를 확인하세요."
        />
      ) : (
        <ul className="template-list">
          {visibleTemplates.map((template) => {
            const personal = template.source === 'user';
            const showPreview = previewId === template.id;
            return (
              <li key={template.id} className="template-card">
                <div className="template-card-heading">
                  <strong>{template.name}</strong>
                  <span>{sourceLabel(template.source)}</span>
                </div>
                {template.description && <p>{template.description}</p>}
                {template.category && (
                  <span className="template-card-category">{template.category}</span>
                )}
                <small title={template.sourceLabel}>{template.sourceLabel}</small>
                <div className="template-card-primary-actions">
                  <button
                    type="button"
                    onClick={() => onApply(template.id)}
                    disabled={busy}
                  >
                    {isApplying ? '적용 중…' : '템플릿 적용'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewId(showPreview ? undefined : template.id)}
                    disabled={!template.preview}
                    aria-expanded={showPreview}
                  >
                    미리보기
                  </button>
                </div>
                {personal && (
                  <details className="template-card-more">
                    <summary>더보기</summary>
                    <div>
                      <button type="button" onClick={() => onEdit(template)} disabled={busy}>수정</button>
                      <button type="button" onClick={() => onDuplicate(template)} disabled={busy}>복제</button>
                      <button type="button" onClick={() => onDelete(template)} disabled={busy}>삭제</button>
                    </div>
                  </details>
                )}
                {showPreview && template.preview && (
                  <div className="template-structural-preview">
                    <strong>구조 미리보기</strong>
                    {template.preview.outline.length > 0 ? (
                      <ol>
                        {template.preview.outline.map((heading, index) => (
                          <li key={`${heading.id ?? heading.text}-${index}`} style={{ paddingLeft: `${(heading.level - 1) * 8}px` }}>
                            H{heading.level} · {heading.text || '(빈 제목)'}
                          </li>
                        ))}
                      </ol>
                    ) : <p>제목 구조가 없습니다.</p>}
                    <p>
                      표 {template.preview.counts.tables} · 그림 {template.preview.counts.figures}
                      {' · '}수식 {template.preview.counts.equations}
                    </p>
                    <p>
                      문서 설정 {template.preview.settingsKeys.length > 0
                        ? template.preview.settingsKeys.join(', ')
                        : '기본값'}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
