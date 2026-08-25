import type { TemplateCatalogDiagnosticView } from '../template/catalogView';
import type {
  ManagedTemplateDescriptor,
  PersonalTemplateOperation,
  TemplateOperationError,
} from '../types/messages';

export type TemplateSourceFilter = 'all' | 'builtin' | 'workspace' | 'user';
export type TemplateActionOperation = 'apply' | 'create' | PersonalTemplateOperation;

export type TemplateCatalogState =
  | { phase: 'idle' }
  | { phase: 'loading'; requestId: string }
  | { phase: 'ready'; requestId: string }
  | { phase: 'failed'; requestId: string; error: TemplateOperationError };

export type TemplateActionState =
  | { phase: 'idle' }
  | { phase: 'confirming' | 'editing'; operation: TemplateActionOperation; templateId?: string }
  | {
    phase: 'running';
    requestId: string;
    operation: TemplateActionOperation;
    templateId?: string;
    visibleIndex?: number;
  }
  | {
    phase: 'completed';
    requestId: string;
    operation: TemplateActionOperation;
    templateId?: string;
  }
  | {
    phase: 'cancelled';
    requestId?: string;
    operation: TemplateActionOperation;
    templateId?: string;
  }
  | {
    phase: 'failed';
    requestId: string;
    operation: TemplateActionOperation;
    templateId?: string;
    error: TemplateOperationError;
  };

interface PostRefreshSelectionById {
  kind: 'id';
  templateId: string;
}

interface PostRefreshSelectionByIndex {
  kind: 'index';
  visibleIndex: number;
}

export interface TemplateSessionState {
  catalog: TemplateCatalogState;
  templates: readonly ManagedTemplateDescriptor[];
  diagnostics: readonly TemplateCatalogDiagnosticView[];
  personalRootScope: 'local' | 'remote';
  query: string;
  source: TemplateSourceFilter;
  category: string;
  selectedId?: string;
  action: TemplateActionState;
  postRefreshSelection?: PostRefreshSelectionById | PostRefreshSelectionByIndex;
  focusIntent?: 'selected' | 'status';
}

export type TemplateSessionEvent =
  | { type: 'catalog-requested'; requestId: string }
  | {
    type: 'catalog-succeeded';
    requestId: string;
    templates: readonly ManagedTemplateDescriptor[];
    diagnostics: readonly TemplateCatalogDiagnosticView[];
    personalRootScope: 'local' | 'remote';
  }
  | { type: 'catalog-failed'; requestId: string; error: TemplateOperationError }
  | { type: 'query-changed'; query: string }
  | { type: 'source-changed'; source: TemplateSourceFilter }
  | { type: 'category-changed'; category: string }
  | { type: 'selected'; templateId?: string }
  | { type: 'action-confirming'; operation: TemplateActionOperation; templateId?: string }
  | { type: 'action-editing'; operation: TemplateActionOperation; templateId?: string }
  | { type: 'action-dialog-cancelled' }
  | {
    type: 'action-started';
    requestId: string;
    operation: TemplateActionOperation;
    templateId?: string;
    visibleIndex?: number;
  }
  | { type: 'action-completed'; requestId: string; templateId?: string }
  | { type: 'action-cancelled'; requestId: string }
  | { type: 'action-failed'; requestId: string; error: TemplateOperationError }
  | { type: 'focus-consumed' }
  | { type: 'action-reset' };

export const createTemplateSessionState = (): TemplateSessionState => ({
  catalog: { phase: 'idle' },
  templates: [],
  diagnostics: [],
  personalRootScope: 'local',
  query: '',
  source: 'all',
  category: 'all',
  action: { phase: 'idle' },
});

const normalized = (value: string | undefined): string =>
  value?.trim().toLocaleLowerCase() ?? '';

export const filterTemplatesForSession = (
  templates: readonly ManagedTemplateDescriptor[],
  state: Pick<TemplateSessionState, 'query' | 'source' | 'category'>,
): ManagedTemplateDescriptor[] => {
  const query = normalized(state.query);
  return templates.filter((template) => {
    if (state.source !== 'all' && template.source !== state.source) return false;
    if (state.category !== 'all' && template.category !== state.category) return false;
    return !query || [template.name, template.description, template.category]
      .some((value) => normalized(value).includes(query));
  });
};

const reconcileSelection = (state: TemplateSessionState): TemplateSessionState => {
  if (!state.selectedId) return state;
  const visible = filterTemplatesForSession(state.templates, state);
  return visible.some((template) => template.id === state.selectedId)
    ? state
    : { ...state, selectedId: undefined };
};

const isMatchingRunningAction = (
  action: TemplateActionState,
  requestId: string,
): action is Extract<TemplateActionState, { phase: 'running' }> =>
  action.phase === 'running' && action.requestId === requestId;

export const templateSessionReducer = (
  state: TemplateSessionState,
  event: TemplateSessionEvent,
): TemplateSessionState => {
  switch (event.type) {
    case 'catalog-requested':
      return { ...state, catalog: { phase: 'loading', requestId: event.requestId } };
    case 'catalog-failed':
      return state.catalog.phase === 'loading' && state.catalog.requestId === event.requestId
        ? { ...state, catalog: { phase: 'failed', requestId: event.requestId, error: event.error } }
        : state;
    case 'catalog-succeeded': {
      if (state.catalog.phase !== 'loading' || state.catalog.requestId !== event.requestId) return state;
      let next: TemplateSessionState = {
        ...state,
        catalog: { phase: 'ready', requestId: event.requestId },
        templates: event.templates,
        diagnostics: event.diagnostics,
        personalRootScope: event.personalRootScope,
        focusIntent: undefined,
      };
      if (state.postRefreshSelection?.kind === 'id') {
        const pendingTemplateId = state.postRefreshSelection.templateId;
        next = {
          ...next,
          query: '',
          source: 'user',
          category: 'all',
          selectedId: event.templates.some((item) => item.id === pendingTemplateId)
            ? pendingTemplateId
            : undefined,
          postRefreshSelection: undefined,
          focusIntent: 'selected',
        };
      } else if (state.postRefreshSelection?.kind === 'index') {
        const visible = filterTemplatesForSession(event.templates, next);
        const selected = visible[Math.min(state.postRefreshSelection.visibleIndex, visible.length - 1)];
        next = {
          ...next,
          selectedId: selected?.id,
          postRefreshSelection: undefined,
          focusIntent: selected ? 'selected' : 'status',
        };
      }
      return reconcileSelection(next);
    }
    case 'query-changed':
      return reconcileSelection({ ...state, query: event.query });
    case 'source-changed':
      return reconcileSelection({ ...state, source: event.source, category: 'all' });
    case 'category-changed':
      return reconcileSelection({ ...state, category: event.category });
    case 'selected':
      return { ...state, selectedId: event.templateId, focusIntent: undefined };
    case 'action-confirming':
      return { ...state, action: { phase: 'confirming', operation: event.operation, templateId: event.templateId } };
    case 'action-editing':
      return { ...state, action: { phase: 'editing', operation: event.operation, templateId: event.templateId } };
    case 'action-dialog-cancelled':
      return state.action.phase === 'confirming' || state.action.phase === 'editing'
        ? {
          ...state,
          action: {
            phase: 'cancelled',
            operation: state.action.operation,
            templateId: state.action.templateId,
          },
          focusIntent: 'selected',
        }
        : state;
    case 'action-started':
      return {
        ...state,
        action: {
          phase: 'running',
          requestId: event.requestId,
          operation: event.operation,
          templateId: event.templateId,
          visibleIndex: event.visibleIndex,
        },
        focusIntent: undefined,
      };
    case 'action-completed': {
      if (!isMatchingRunningAction(state.action, event.requestId)) return state;
      const operation = state.action.operation;
      const templateId = event.templateId ?? state.action.templateId;
      const postRefreshSelection = operation === 'save' || operation === 'duplicate'
        ? (templateId ? { kind: 'id' as const, templateId } : undefined)
        : operation === 'delete'
          ? { kind: 'index' as const, visibleIndex: state.action.visibleIndex ?? 0 }
          : undefined;
      return {
        ...state,
        action: { phase: 'completed', requestId: event.requestId, operation, templateId },
        postRefreshSelection,
        focusIntent: operation === 'update' ? 'selected' : undefined,
      };
    }
    case 'action-cancelled':
      return isMatchingRunningAction(state.action, event.requestId)
        ? {
          ...state,
          action: {
            phase: 'cancelled',
            requestId: event.requestId,
            operation: state.action.operation,
            templateId: state.action.templateId,
          },
          focusIntent: 'selected',
        }
        : state;
    case 'action-failed':
      return isMatchingRunningAction(state.action, event.requestId)
        ? {
          ...state,
          action: {
            phase: 'failed',
            requestId: event.requestId,
            operation: state.action.operation,
            templateId: state.action.templateId,
            error: event.error,
          },
          focusIntent: 'selected',
        }
        : state;
    case 'focus-consumed':
      return { ...state, focusIntent: undefined };
    case 'action-reset':
      return { ...state, action: { phase: 'idle' } };
  }
};
