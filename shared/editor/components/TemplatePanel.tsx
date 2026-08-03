import React, { useEffect, useId, useMemo, useRef } from 'react';
import { FolderOpen, LayoutTemplate, RefreshCw, Save } from 'lucide-react';
import type { TemplateCatalogDiagnosticView, TemplateSource } from '../../template/catalogView';
import type { ManagedTemplateDescriptor, PersonalTemplateMetadataInput, TemplateErrorCode } from '../../types/messages';
import {
  filterTemplatesForSession,
  type TemplateSessionEvent,
  type TemplateSessionState,
  type TemplateSourceFilter,
} from '../templateSession';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';
import { PanelEmptyState } from './PanelEmptyState';
import { TemplateConfirmDialog, TemplateMetadataDialog } from './TemplateDialogs';

export type { TemplateSourceFilter } from '../templateSession';

export interface TemplateDiscoveryFilters {
  query: string;
  source: TemplateSourceFilter;
  category: string;
}

export interface TemplateCapability {
  available: boolean;
  reason?: string;
}

export interface TemplatePanelCapabilities {
  apply?: TemplateCapability;
  save?: TemplateCapability;
  update?: TemplateCapability;
  duplicate?: TemplateCapability;
  delete?: TemplateCapability;
  openFolder?: TemplateCapability;
}

interface TemplatePanelProps {
  session: TemplateSessionState;
  dispatch: React.Dispatch<TemplateSessionEvent>;
  capabilities?: TemplatePanelCapabilities;
  onRefresh?: () => void;
  onApply?: (templateId: string) => void;
  onSaveCurrent?: (metadata: PersonalTemplateMetadataInput) => void;
  onEdit?: (template: ManagedTemplateDescriptor, metadata: PersonalTemplateMetadataInput) => void;
  onDuplicate?: (template: ManagedTemplateDescriptor, metadata: PersonalTemplateMetadataInput) => void;
  onDelete?: (template: ManagedTemplateDescriptor, visibleIndex: number) => void;
  onOpenPersonalFolder?: () => void;
}

const sourceLabelKey = (source: TemplateSource): EditorTranslationKey => {
  if (source === 'builtin') return 'template.sourceBuiltin';
  if (source === 'workspace') return 'template.sourceWorkspace';
  return 'template.sourceUser';
};

const SOURCE_FILTERS: ReadonlyArray<{ id: TemplateSourceFilter; labelKey: EditorTranslationKey }> = [
  { id: 'all', labelKey: 'crossRef.filterAll' },
  { id: 'builtin', labelKey: 'template.sourceBuiltin' },
  { id: 'workspace', labelKey: 'template.sourceWorkspace' },
  { id: 'user', labelKey: 'template.sourceUser' },
];

export function filterTemplateCatalog(
  templates: readonly ManagedTemplateDescriptor[],
  filters: TemplateDiscoveryFilters,
): ManagedTemplateDescriptor[] {
  return filterTemplatesForSession(templates, filters);
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
  t: (key: EditorTranslationKey, params?: Record<string, string | number>) => string,
): string => diagnostic.source === 'catalog'
  ? t('template.sourceCatalog')
  : t(sourceLabelKey(diagnostic.source));

const recoveryKey = (
  recovery: TemplateCatalogDiagnosticView['recovery'],
): EditorTranslationKey | undefined => {
  if (recovery === 'retry') return 'template.recoveryRetry';
  if (recovery === 'fix-source') return 'template.recoveryFixSource';
  if (recovery === 'resolve-duplicate') return 'template.recoveryDuplicate';
  return undefined;
};

const errorKey = (code: TemplateErrorCode): EditorTranslationKey => {
  switch (code) {
    case 'catalog-unavailable': return 'template.errorCatalogUnavailable';
    case 'document-changed': return 'template.errorDocumentChanged';
    case 'template-unavailable': return 'template.errorUnavailable';
    case 'template-changed': return 'template.errorChanged';
    case 'invalid-document': return 'template.errorInvalidDocument';
    case 'operation-failed': return 'template.errorOperationFailed';
  }
};

const actionStatusKey = (
  phase: 'completed' | 'cancelled',
): EditorTranslationKey => phase === 'completed'
  ? 'template.actionCompleted'
  : 'template.actionCancelled';

export const TemplatePanel: React.FC<TemplatePanelProps> = ({
  session,
  dispatch,
  capabilities = {},
  onRefresh,
  onApply,
  onSaveCurrent,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenPersonalFolder,
}) => {
  const { t } = useEditorI18n();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const statusRef = useRef<HTMLDivElement>(null);
  const actionTriggerRef = useRef<HTMLElement | null>(null);
  const capabilityReasonId = useId();
  const categories = useMemo(
    () => getTemplateCategories(session.templates, session.source),
    [session.source, session.templates],
  );
  const effectiveCategory = session.category === 'all' || categories.includes(session.category)
    ? session.category
    : 'all';
  const visibleTemplates = useMemo(
    () => filterTemplateCatalog(session.templates, {
      query: session.query,
      source: session.source,
      category: effectiveCategory,
    }),
    [effectiveCategory, session.query, session.source, session.templates],
  );
  const selectedTemplate = visibleTemplates.find((template) => template.id === session.selectedId);
  const isLoading = session.catalog.phase === 'loading';
  const isRunning = session.action.phase === 'running';
  const isApplying = session.action.phase === 'running' && session.action.operation === 'apply';
  const hasRetryableDiagnostic = session.diagnostics.some((item) => item.recovery === 'retry');
  const capability = (
    key: keyof TemplatePanelCapabilities,
    callback: unknown,
  ): TemplateCapability => capabilities[key] ?? {
    available: typeof callback === 'function',
    reason: t('template.capabilityUnavailable'),
  };
  const applyCapability = capability('apply', onApply);
  const saveCapability = capability('save', onSaveCurrent);
  const updateCapability = capability('update', onEdit);
  const duplicateCapability = capability('duplicate', onDuplicate);
  const deleteCapability = capability('delete', onDelete);
  const openFolderCapability = capability('openFolder', onOpenPersonalFolder);

  useEffect(() => {
    if (session.category !== effectiveCategory) {
      dispatch({ type: 'category-changed', category: effectiveCategory });
    }
  }, [dispatch, effectiveCategory, session.category]);

  useEffect(() => {
    if (!session.focusIntent) return;
    if (session.focusIntent === 'selected' && session.selectedId) {
      rowRefs.current.get(session.selectedId)?.focus();
    } else if (session.focusIntent === 'selected' && actionTriggerRef.current?.isConnected) {
      actionTriggerRef.current.focus();
    } else {
      statusRef.current?.focus();
    }
    dispatch({ type: 'focus-consumed' });
  }, [dispatch, session.focusIntent, session.selectedId]);

  const invokeCapability = (
    item: TemplateCapability,
    callback: (() => void) | undefined,
    trigger?: HTMLElement,
  ): void => {
    if (isRunning || !item.available) return;
    actionTriggerRef.current = trigger ?? null;
    callback?.();
  };

  const dialogAction = session.action.phase === 'confirming' || session.action.phase === 'editing'
    ? session.action
    : undefined;
  const dialogTemplate = session.templates.find(
    (template) => template.id === dialogAction?.templateId,
  );
  const cancelDialog = (): void => dispatch({ type: 'action-dialog-cancelled' });

  return (
    <section className="template-panel" aria-labelledby="template-panel-title">
      <div className="template-panel-header">
        <div id="template-panel-title" className="side-panel-section-title">{t('template.title')}</div>
        <button
          type="button"
          className="template-panel-refresh"
          onClick={onRefresh}
          disabled={isLoading || isRunning || !onRefresh}
          aria-label={t('template.refresh')}
          title={t('template.refresh')}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="side-panel-section-desc">{t('template.applyPolicy')}</p>

      <div className="template-discovery">
        <label htmlFor="template-search">{t('template.searchLabel')}</label>
        <input
          id="template-search"
          type="search"
          value={session.query}
          onChange={(event) => dispatch({ type: 'query-changed', query: event.currentTarget.value })}
          placeholder={t('common.search')}
        />
        <div className="template-filter" role="group" aria-label={t('template.sourceFilter')}>
          {SOURCE_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={session.source === item.id}
              onClick={() => dispatch({ type: 'source-changed', source: item.id })}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
        <label htmlFor="template-category-filter">{t('template.categoryLabel')}</label>
        <select
          id="template-category-filter"
          value={effectiveCategory}
          onChange={(event) => dispatch({ type: 'category-changed', category: event.currentTarget.value })}
        >
          <option value="all">{t('template.allCategories')}</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <p className="template-result-count" aria-live="polite">
          {t(visibleTemplates.length === 1 ? 'template.resultOne' : 'template.resultMany', {
            count: visibleTemplates.length,
          })}
        </p>
      </div>

      {session.diagnostics.length > 0 && (
        <div className="template-panel-diagnostic" role="status">
          <strong>{t(
            session.diagnostics.length === 1 ? 'template.diagnosticsOne' : 'template.diagnostics',
            { count: session.diagnostics.length },
          )}</strong>
          <p>{t('template.diagnosticsSafe')}</p>
          <details>
            <summary>{t('template.diagnosticsDetails')}</summary>
            <ul>
              {session.diagnostics.map((diagnostic) => {
                const key = recoveryKey(diagnostic.recovery);
                return (
                  <li key={diagnostic.id} data-severity={diagnostic.severity}>
                    <strong>{diagnostic.targetLabel}</strong>
                    <span>{diagnosticSourceLabel(diagnostic, t)} · {diagnostic.code}</span>
                    {diagnostic.detail && <p>{diagnostic.detail}</p>}
                    {diagnostic.jsonPath && <code>{diagnostic.jsonPath}</code>}
                    {key && <p>{t(key)}</p>}
                  </li>
                );
              })}
            </ul>
          </details>
          {hasRetryableDiagnostic && (
            <button type="button" onClick={onRefresh} disabled={isLoading || isRunning || !onRefresh}>
              <RefreshCw size={13} aria-hidden="true" /> {t('common.retry')}
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
        <ul className="template-list" aria-label={t('template.resultsLabel')}>
          {visibleTemplates.map((template) => {
            const selected = session.selectedId === template.id;
            return (
              <li key={template.id} className="template-card">
                <button
                  ref={(element) => {
                    if (element) rowRefs.current.set(template.id, element);
                    else rowRefs.current.delete(template.id);
                  }}
                  type="button"
                  className="template-select-row"
                  aria-pressed={selected}
                  onClick={() => dispatch({ type: 'selected', templateId: template.id })}
                >
                  <span className="template-card-heading">
                    <strong>{template.name}</strong>
                    <span>{t(sourceLabelKey(template.source))}</span>
                  </span>
                  {template.description && <span>{template.description}</span>}
                  {template.category && <span className="template-card-category">{template.category}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedTemplate && (
        <section className="template-selected-preview" aria-labelledby="template-selected-preview-title">
          <div id="template-selected-preview-title" className="template-card-heading">
            <strong>{selectedTemplate.name}</strong><span>{t('common.preview')}</span>
          </div>
          {selectedTemplate.preview && (
            <div className="template-structural-preview">
              <strong>{t('template.structurePreview')}</strong>
              {selectedTemplate.preview.outline.length > 0 ? (
                <ol>{selectedTemplate.preview.outline.map((heading, index) => (
                  <li key={`${heading.id ?? heading.text}-${index}`} style={{ paddingLeft: `${(heading.level - 1) * 8}px` }}>
                    H{heading.level} · {heading.text || t('template.emptyHeading')}
                  </li>
                ))}</ol>
              ) : <p>{t('template.noOutline')}</p>}
              <p>{t('template.counts', {
                tables: selectedTemplate.preview.counts.tables,
                figures: selectedTemplate.preview.counts.figures,
                equations: selectedTemplate.preview.counts.equations,
              })}</p>
              <p>{t('template.settings', {
                settings: selectedTemplate.preview.settingsKeys.length > 0
                  ? selectedTemplate.preview.settingsKeys.join(', ')
                  : t('template.defaults'),
              })}</p>
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        className="template-apply-primary"
        disabled={!selectedTemplate || isRunning}
        aria-disabled={!applyCapability.available || undefined}
        aria-describedby={!applyCapability.available ? `${capabilityReasonId}-apply` : undefined}
        title={!applyCapability.available ? applyCapability.reason : undefined}
        onClick={(event) => invokeCapability(applyCapability, () => dispatch({
          type: 'action-confirming', operation: 'apply', templateId: selectedTemplate?.id,
        }), event.currentTarget)}
      >
        {isApplying ? t('template.applying') : t('template.apply')}
      </button>
      {!applyCapability.available && <p id={`${capabilityReasonId}-apply`} className="template-capability-reason">{applyCapability.reason}</p>}

      <details className="template-personal-management">
        <summary>{t('template.sourceUser')}</summary>
        <p>{session.personalRootScope === 'remote' ? t('template.remoteStore') : t('template.localStore')} · ~/.sdoc/templates</p>
        <div className="template-personal-actions">
          <button
            type="button"
            aria-disabled={!saveCapability.available || undefined}
            aria-describedby={!saveCapability.available ? `${capabilityReasonId}-save` : undefined}
            title={!saveCapability.available ? saveCapability.reason : undefined}
            disabled={isRunning}
            onClick={(event) => invokeCapability(saveCapability, () => dispatch({ type: 'action-editing', operation: 'save' }), event.currentTarget)}
          ><Save size={13} aria-hidden="true" /> {t('template.saveCurrent')}</button>
          <button
            type="button"
            aria-disabled={!openFolderCapability.available || undefined}
            aria-describedby={!openFolderCapability.available ? `${capabilityReasonId}-open-folder` : undefined}
            title={!openFolderCapability.available ? openFolderCapability.reason : undefined}
            disabled={isRunning}
            onClick={(event) => invokeCapability(openFolderCapability, onOpenPersonalFolder, event.currentTarget)}
          ><FolderOpen size={13} aria-hidden="true" /> {t('template.openPersonalFolder')}</button>
          {selectedTemplate?.source === 'user' && (
            <>
              <button type="button" disabled={isRunning} aria-disabled={!updateCapability.available || undefined} aria-describedby={!updateCapability.available ? `${capabilityReasonId}-update` : undefined} title={!updateCapability.available ? updateCapability.reason : undefined} onClick={(event) => invokeCapability(updateCapability, () => dispatch({ type: 'action-editing', operation: 'update', templateId: selectedTemplate.id }), event.currentTarget)}>{t('template.edit')}</button>
              <button type="button" disabled={isRunning} aria-disabled={!duplicateCapability.available || undefined} aria-describedby={!duplicateCapability.available ? `${capabilityReasonId}-duplicate` : undefined} title={!duplicateCapability.available ? duplicateCapability.reason : undefined} onClick={(event) => invokeCapability(duplicateCapability, () => dispatch({ type: 'action-editing', operation: 'duplicate', templateId: selectedTemplate.id }), event.currentTarget)}>{t('template.duplicate')}</button>
              <button type="button" disabled={isRunning} aria-disabled={!deleteCapability.available || undefined} aria-describedby={!deleteCapability.available ? `${capabilityReasonId}-delete` : undefined} title={!deleteCapability.available ? deleteCapability.reason : undefined} onClick={(event) => invokeCapability(deleteCapability, () => dispatch({ type: 'action-confirming', operation: 'delete', templateId: selectedTemplate.id }), event.currentTarget)}>{t('common.delete')}</button>
            </>
          )}
        </div>
        <div className="template-capability-reasons">
          {!saveCapability.available && <p id={`${capabilityReasonId}-save`}>{saveCapability.reason}</p>}
          {!openFolderCapability.available && <p id={`${capabilityReasonId}-open-folder`}>{openFolderCapability.reason}</p>}
          {selectedTemplate?.source === 'user' && !updateCapability.available && <p id={`${capabilityReasonId}-update`}>{updateCapability.reason}</p>}
          {selectedTemplate?.source === 'user' && !duplicateCapability.available && <p id={`${capabilityReasonId}-duplicate`}>{duplicateCapability.reason}</p>}
          {selectedTemplate?.source === 'user' && !deleteCapability.available && <p id={`${capabilityReasonId}-delete`}>{deleteCapability.reason}</p>}
        </div>
      </details>

      <div ref={statusRef} className="template-status" tabIndex={-1}>
        {session.catalog.phase === 'failed' && <p role="alert">{t(errorKey(session.catalog.error.code))}</p>}
        {(session.action.phase === 'completed' || session.action.phase === 'cancelled') && (
          <p aria-live="polite">{t(actionStatusKey(session.action.phase))}</p>
        )}
        {session.action.phase === 'failed' && <p role="alert">{t(errorKey(session.action.error.code))}</p>}
      </div>

      {session.action.phase === 'confirming' && session.action.operation === 'apply' && dialogTemplate && (
        <TemplateConfirmDialog
          title={t('template.applyDialogTitle')}
          description={t('template.applyConfirm')}
          confirmLabel={t('template.apply')}
          cancelLabel={t('common.cancel')}
          onCancel={cancelDialog}
          onConfirm={() => onApply?.(dialogTemplate.id)}
        />
      )}
      {session.action.phase === 'confirming' && session.action.operation === 'delete' && dialogTemplate && (
        <TemplateConfirmDialog
          title={t('template.deleteDialogTitle')}
          description={t('template.deleteConfirm', { name: dialogTemplate.name })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          destructive
          onCancel={cancelDialog}
          onConfirm={() => onDelete?.(dialogTemplate, visibleTemplates.indexOf(dialogTemplate))}
        />
      )}
      {session.action.phase === 'editing' && (
        <TemplateMetadataDialog
          title={t(session.action.operation === 'save'
            ? 'template.saveDialogTitle'
            : session.action.operation === 'update'
              ? 'template.editDialogTitle'
              : 'template.duplicateDialogTitle')}
          defaults={session.action.operation === 'save'
            ? { name: t('template.untitled') }
            : session.action.operation === 'duplicate'
              ? { name: t('template.copySuffix', { name: dialogTemplate?.name ?? '' }), description: dialogTemplate?.description, category: dialogTemplate?.category }
              : { name: dialogTemplate?.name ?? '', description: dialogTemplate?.description, category: dialogTemplate?.category }}
          nameLabel={t('template.nameLabel')}
          descriptionLabel={t('template.descriptionLabel')}
          categoryLabel={t('template.categoryLabel')}
          nameError={t('template.nameValidation')}
          descriptionError={t('template.descriptionValidation')}
          categoryError={t('template.categoryValidation')}
          submitLabel={t('common.save')}
          cancelLabel={t('common.cancel')}
          onCancel={cancelDialog}
          onSubmit={(metadata) => {
            if (session.action.phase !== 'editing') return;
            if (session.action.operation === 'save') onSaveCurrent?.(metadata);
            else if (session.action.operation === 'update' && dialogTemplate) onEdit?.(dialogTemplate, metadata);
            else if (session.action.operation === 'duplicate' && dialogTemplate) onDuplicate?.(dialogTemplate, metadata);
          }}
        />
      )}
    </section>
  );
};
