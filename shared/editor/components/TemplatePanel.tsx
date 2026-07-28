import React, { useEffect, useMemo, useState } from 'react';
import { FolderOpen, LayoutTemplate, RefreshCw, Save } from 'lucide-react';
import type { ManagedTemplateDescriptor } from '../../types/messages';
import type {
  TemplateCatalogDiagnosticView,
  TemplateSource,
} from '../../template/catalogView';
import { PanelEmptyState } from './PanelEmptyState';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

export type TemplateSourceFilter = 'all' | TemplateSource;

export interface TemplateDiscoveryFilters {
  query: string;
  source: TemplateSourceFilter;
  category: string;
}

interface TemplatePanelProps {
  templates: readonly ManagedTemplateDescriptor[];
  diagnostics?: readonly TemplateCatalogDiagnosticView[];
  isApplying: boolean;
  isManaging: boolean;
  isLoading?: boolean;
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

const SOURCE_FILTERS: ReadonlyArray<{
  id: TemplateSourceFilter;
  labelKey: EditorTranslationKey;
}> = [
  { id: 'all', labelKey: 'crossRef.filterAll' },
  { id: 'builtin', labelKey: 'template.sourceBuiltin' },
  { id: 'workspace', labelKey: 'template.sourceWorkspace' },
  { id: 'user', labelKey: 'template.sourceUser' },
];

const normalizedSearchText = (value: string | undefined): string =>
  value?.trim().toLocaleLowerCase() ?? '';

/**
 * Discovery intentionally indexes descriptive metadata only. Host paths and
 * source labels must never become searchable UI data.
 */
export function filterTemplateCatalog(
  templates: readonly ManagedTemplateDescriptor[],
  filters: TemplateDiscoveryFilters,
): ManagedTemplateDescriptor[] {
  const query = normalizedSearchText(filters.query);
  return templates.filter((template) => {
    if (filters.source !== 'all' && template.source !== filters.source) return false;
    if (filters.category !== 'all' && template.category !== filters.category) return false;
    if (!query) return true;
    return [template.name, template.description, template.category]
      .some((value) => normalizedSearchText(value).includes(query));
  });
}

export function getTemplateCategories(
  templates: readonly ManagedTemplateDescriptor[],
  source: TemplateSourceFilter,
): string[] {
  const categories = new Set<string>();
  for (const template of templates) {
    if (source !== 'all' && template.source !== source) continue;
    const category = template.category?.trim();
    if (category) categories.add(category);
  }
  return [...categories].sort((left, right) => left.localeCompare(right));
}

export function selectedTemplateAfterFiltering(
  selectedId: string | undefined,
  visibleTemplates: readonly ManagedTemplateDescriptor[],
): string | undefined {
  return selectedId && visibleTemplates.some((template) => template.id === selectedId)
    ? selectedId
    : undefined;
}

const diagnosticSourceLabel = (
  diagnostic: TemplateCatalogDiagnosticView,
  t: (key: EditorTranslationKey) => string,
): string => diagnostic.source === 'catalog'
  ? 'Catalog'
  : t(sourceLabelKey(diagnostic.source));

const diagnosticRecoveryText = (
  recovery: TemplateCatalogDiagnosticView['recovery'],
): string | undefined => {
  if (recovery === 'retry') return 'Refresh the catalog to try again.';
  if (recovery === 'fix-source') return 'Fix or remove the source template, then refresh.';
  if (recovery === 'resolve-duplicate') return 'Give each template a unique template ID.';
  return undefined;
};

export const TemplatePanel: React.FC<TemplatePanelProps> = ({
  templates,
  diagnostics = [],
  isApplying,
  isManaging,
  isLoading = false,
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
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<TemplateSourceFilter>('all');
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string>();
  const categories = useMemo(
    () => getTemplateCategories(templates, source),
    [source, templates],
  );
  const effectiveCategory = category === 'all' || categories.includes(category)
    ? category
    : 'all';
  const visibleTemplates = useMemo(
    () => filterTemplateCatalog(templates, {
      query,
      source,
      category: effectiveCategory,
    }),
    [effectiveCategory, query, source, templates],
  );
  const visibleSelectedId = selectedTemplateAfterFiltering(selectedId, visibleTemplates);
  const selectedTemplate = visibleTemplates.find(
    (template) => template.id === visibleSelectedId,
  );
  const busy = isApplying || isManaging || isLoading;
  const hasRetryableDiagnostic = diagnostics.some(
    (diagnostic) => diagnostic.recovery === 'retry',
  );

  useEffect(() => {
    if (category !== effectiveCategory) setCategory(effectiveCategory);
  }, [category, effectiveCategory]);

  useEffect(() => {
    if (selectedId !== visibleSelectedId) setSelectedId(visibleSelectedId);
  }, [selectedId, visibleSelectedId]);

  return (
    <section className="template-panel" aria-labelledby="template-panel-title">
      <div className="template-panel-header">
        <div id="template-panel-title" className="side-panel-section-title">
          {t('template.title')}
        </div>
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
      <p className="side-panel-section-desc">{t('template.applyPolicy')}</p>

      <div className="template-discovery">
        <label htmlFor="template-search">Search templates</label>
        <input
          id="template-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t('common.search')}
        />
        <div className="template-filter" role="group" aria-label={t('template.sourceFilter')}>
          {SOURCE_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={source === item.id}
              onClick={() => setSource(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
        <label htmlFor="template-category-filter">Category</label>
        <select
          id="template-category-filter"
          value={effectiveCategory}
          onChange={(event) => setCategory(event.currentTarget.value)}
        >
          <option value="all">All categories</option>
          {categories.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <p className="template-result-count" aria-live="polite">
          {visibleTemplates.length} {visibleTemplates.length === 1 ? 'result' : 'results'}
        </p>
      </div>

      {diagnostics.length > 0 && (
        <div className="template-panel-diagnostic" role="status">
          <strong>
            {diagnostics.length === 1
              ? '1 template could not be loaded.'
              : `${diagnostics.length} templates could not be loaded.`}
          </strong>
          <p>Available templates are still safe to use.</p>
          <details>
            <summary>Show diagnostic details</summary>
            <ul>
              {diagnostics.map((diagnostic) => {
                const recovery = diagnosticRecoveryText(diagnostic.recovery);
                return (
                  <li key={diagnostic.id} data-severity={diagnostic.severity}>
                    <strong>{diagnostic.targetLabel}</strong>
                    <span>
                      {diagnosticSourceLabel(diagnostic, t)} · {diagnostic.code}
                    </span>
                    {diagnostic.detail && <p>{diagnostic.detail}</p>}
                    {diagnostic.jsonPath && <code>{diagnostic.jsonPath}</code>}
                    {recovery && <p>{recovery}</p>}
                  </li>
                );
              })}
            </ul>
          </details>
          {hasRetryableDiagnostic && (
            <button type="button" onClick={onRefresh} disabled={busy}>
              <RefreshCw size={13} aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      )}

      {visibleTemplates.length === 0 ? (
        <PanelEmptyState
          icon={<LayoutTemplate size={22} />}
          title={isLoading ? t('template.loading') : t('template.empty')}
          message={t('template.emptyMessage')}
        />
      ) : (
        <ul className="template-list" aria-label="Template results">
          {visibleTemplates.map((template) => {
            const selected = visibleSelectedId === template.id;
            return (
              <li key={template.id} className="template-card">
                <button
                  type="button"
                  className="template-select-row"
                  aria-pressed={selected}
                  onClick={() => setSelectedId(template.id)}
                >
                  <span className="template-card-heading">
                    <strong>{template.name}</strong>
                    <span>{t(sourceLabelKey(template.source))}</span>
                  </span>
                  {template.description && <span>{template.description}</span>}
                  {template.category && (
                    <span className="template-card-category">{template.category}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedTemplate && (
        <section
          className="template-selected-preview"
          aria-labelledby="template-selected-preview-title"
        >
          <div id="template-selected-preview-title" className="template-card-heading">
            <strong>{selectedTemplate.name}</strong>
            <span>{t('common.preview')}</span>
          </div>
          {selectedTemplate.preview ? (
            <div className="template-structural-preview">
              <strong>{t('template.structurePreview')}</strong>
              {selectedTemplate.preview.outline.length > 0 ? (
                <ol>
                  {selectedTemplate.preview.outline.map((heading, index) => (
                    <li
                      key={`${heading.id ?? heading.text}-${index}`}
                      style={{ paddingLeft: `${(heading.level - 1) * 8}px` }}
                    >
                      H{heading.level} · {heading.text || t('template.emptyHeading')}
                    </li>
                  ))}
                </ol>
              ) : <p>{t('template.noOutline')}</p>}
              <p>
                {t('template.counts', {
                  tables: selectedTemplate.preview.counts.tables,
                  figures: selectedTemplate.preview.counts.figures,
                  equations: selectedTemplate.preview.counts.equations,
                })}
              </p>
              <p>
                {t('template.settings', {
                  settings: selectedTemplate.preview.settingsKeys.length > 0
                    ? selectedTemplate.preview.settingsKeys.join(', ')
                    : t('template.defaults'),
                })}
              </p>
            </div>
          ) : <p>{t('common.unavailable')}</p>}
        </section>
      )}

      <button
        type="button"
        className="template-apply-primary"
        onClick={() => selectedTemplate && onApply(selectedTemplate.id)}
        disabled={busy || !selectedTemplate}
      >
        {isApplying ? t('template.applying') : t('template.apply')}
      </button>

      <details className="template-personal-management">
        <summary>{t('template.sourceUser')}</summary>
        <p className="template-personal-location">
          {personalRootScope === 'remote' ? 'Remote' : 'Local'} · ~/.sdoc/templates
        </p>
        <div className="template-personal-actions">
          <button type="button" onClick={onSaveCurrent} disabled={busy}>
            <Save size={13} aria-hidden="true" />
            {t('template.saveCurrent')}
          </button>
          <button type="button" onClick={onOpenPersonalFolder} disabled={isManaging}>
            <FolderOpen size={13} aria-hidden="true" />
            {t('template.openPersonalFolder')}
          </button>
        </div>
        {selectedTemplate?.source === 'user' && (
          <div className="template-personal-selected-actions">
            <button type="button" onClick={() => onEdit(selectedTemplate)} disabled={busy}>
              {t('template.edit')}
            </button>
            <button type="button" onClick={() => onDuplicate(selectedTemplate)} disabled={busy}>
              {t('template.duplicate')}
            </button>
            <button type="button" onClick={() => onDelete(selectedTemplate)} disabled={busy}>
              {t('common.delete')}
            </button>
          </div>
        )}
      </details>
    </section>
  );
};
