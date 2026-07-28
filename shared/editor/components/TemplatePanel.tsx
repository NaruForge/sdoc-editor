import React, { useMemo, useState } from 'react';
import { FolderOpen, LayoutTemplate, RefreshCw, Save } from 'lucide-react';
import type { ManagedTemplateDescriptor } from '../../types/messages';
import type { TemplateSource } from '../../template';
import { PanelEmptyState } from './PanelEmptyState';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

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

const sourceLabelKey = (source: TemplateSource): EditorTranslationKey => {
  if (source === 'builtin') return 'template.sourceBuiltin';
  if (source === 'workspace') return 'template.sourceWorkspace';
  return 'template.sourceUser';
};

const FILTERS: ReadonlyArray<{ id: TemplateFilter; labelKey: EditorTranslationKey }> = [
  { id: 'all', labelKey: 'crossRef.filterAll' },
  { id: 'builtin', labelKey: 'template.sourceBuiltin' },
  { id: 'workspace', labelKey: 'template.sourceWorkspace' },
  { id: 'user', labelKey: 'template.sourceUser' },
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
  const { t } = useEditorI18n();
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
        <div id="template-panel-title" className="side-panel-section-title">{t('template.title')}</div>
        <button
          type="button"
          className="template-panel-refresh"
          onClick={onRefresh}
          disabled={busy}
          aria-label={t('template.refresh')}
          title={t('template.refresh')}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="side-panel-section-desc">
        {t('template.applyPolicy')}
      </p>
      <div className="template-personal-actions">
        <button type="button" onClick={onSaveCurrent} disabled={busy}>
          <Save size={13} aria-hidden="true" />
          {t('template.saveCurrent')}
        </button>
        <button
          type="button"
          onClick={onOpenPersonalFolder}
          disabled={isManaging}
          title={personalRootPath}
        >
          <FolderOpen size={13} aria-hidden="true" />
          {t('template.openPersonalFolder')}
        </button>
      </div>
      <p className="template-personal-location" title={personalRootPath}>
        {personalRootScope === 'remote' ? t('template.remoteStore') : t('template.localStore')} · {personalRootPath}
      </p>
      <div className="template-filter" role="group" aria-label={t('template.sourceFilter')}>
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      {diagnosticCount > 0 && (
        <p className="template-panel-diagnostic" role="status">
          {t('template.diagnostics', { count: diagnosticCount })}
        </p>
      )}
      {visibleTemplates.length === 0 ? (
        <PanelEmptyState
          icon={<LayoutTemplate size={22} />}
          title={isLoading ? t('template.loading') : t('template.empty')}
          message={t('template.emptyMessage')}
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
                  <span>{t(sourceLabelKey(template.source))}</span>
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
                    {isApplying ? t('template.applying') : t('template.apply')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewId(showPreview ? undefined : template.id)}
                    disabled={!template.preview}
                    aria-expanded={showPreview}
                  >
                    {t('common.preview')}
                  </button>
                </div>
                {personal && (
                  <details className="template-card-more">
                    <summary>{t('template.more')}</summary>
                    <div>
                      <button type="button" onClick={() => onEdit(template)} disabled={busy}>{t('template.edit')}</button>
                      <button type="button" onClick={() => onDuplicate(template)} disabled={busy}>{t('template.duplicate')}</button>
                      <button type="button" onClick={() => onDelete(template)} disabled={busy}>{t('common.delete')}</button>
                    </div>
                  </details>
                )}
                {showPreview && template.preview && (
                  <div className="template-structural-preview">
                    <strong>{t('template.structurePreview')}</strong>
                    {template.preview.outline.length > 0 ? (
                      <ol>
                        {template.preview.outline.map((heading, index) => (
                          <li key={`${heading.id ?? heading.text}-${index}`} style={{ paddingLeft: `${(heading.level - 1) * 8}px` }}>
                            H{heading.level} · {heading.text || t('template.emptyHeading')}
                          </li>
                        ))}
                      </ol>
                    ) : <p>{t('template.noOutline')}</p>}
                    <p>
                      {t('template.counts', {
                        tables: template.preview.counts.tables,
                        figures: template.preview.counts.figures,
                        equations: template.preview.counts.equations,
                      })}
                    </p>
                    <p>
                      {t('template.settings', {
                        settings: template.preview.settingsKeys.length > 0
                          ? template.preview.settingsKeys.join(', ')
                          : t('template.defaults'),
                      })}
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
