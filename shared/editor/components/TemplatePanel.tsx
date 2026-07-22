import React from 'react';
import { LayoutTemplate, RefreshCw } from 'lucide-react';
import type { TemplateDescriptor } from '../../template';
import { PanelEmptyState } from './PanelEmptyState';

interface TemplatePanelProps {
  templates: readonly TemplateDescriptor[];
  isApplying: boolean;
  isLoading?: boolean;
  diagnosticCount?: number;
  onApply: (templateId: string) => void;
  onRefresh: () => void;
}

const sourceLabel = (source: TemplateDescriptor['source']): string => {
  if (source === 'builtin') return '내장';
  if (source === 'workspace') return '워크스페이스';
  return '사용자';
};

export const TemplatePanel: React.FC<TemplatePanelProps> = ({
  templates,
  isApplying,
  isLoading = false,
  diagnosticCount = 0,
  onApply,
  onRefresh,
}) => (
  <section className="template-panel" aria-labelledby="template-panel-title">
    <div className="template-panel-header">
      <div>
        <div id="template-panel-title" className="side-panel-section-title">문서 템플릿</div>
        <div className="template-panel-experimental">실험적 기능</div>
      </div>
      <button
        type="button"
        className="template-panel-refresh"
        onClick={onRefresh}
        disabled={isLoading || isApplying}
        aria-label="템플릿 목록 새로 고침"
        title="템플릿 목록 새로 고침"
      >
        <RefreshCw size={14} aria-hidden="true" />
      </button>
    </div>
    <p className="side-panel-section-desc">
      템플릿은 현재 본문과 문서 설정을 대체합니다. 제목·작성자·버전·생성일은 유지되며 적용 전 확인할 수 있습니다.
    </p>
    {diagnosticCount > 0 && (
      <p className="template-panel-diagnostic" role="status">
        불러오지 못한 템플릿 {diagnosticCount}개가 있습니다.
      </p>
    )}
    {templates.length === 0 ? (
      <PanelEmptyState
        icon={<LayoutTemplate size={22} />}
        title={isLoading ? '템플릿을 불러오는 중입니다' : '사용 가능한 템플릿이 없습니다'}
        message="내장 템플릿 또는 .sdoc/templates 폴더를 확인하세요."
      />
    ) : (
      <ul className="template-list">
        {templates.map((template) => (
          <li key={template.id} className="template-card">
            <div className="template-card-heading">
              <strong>{template.name}</strong>
              <span>{sourceLabel(template.source)}</span>
            </div>
            {template.description && <p>{template.description}</p>}
            <small title={template.sourceLabel}>{template.sourceLabel}</small>
            <button
              type="button"
              onClick={() => onApply(template.id)}
              disabled={isApplying}
            >
              {isApplying ? '적용 중…' : '템플릿 적용'}
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);
