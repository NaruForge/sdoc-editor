import React, { useEffect, useId, useRef, useState } from 'react';
import type {
  DiagramRendererSettings,
  ResolvedDiagramRendererConsent,
} from '../../diagramRenderer';
import { useEditorI18n } from '../i18n';

export interface DiagramRendererConsentPanelLabels {
  title?: string;
  description?: string;
}

export interface DiagramRendererConsentPanelProps {
  settings: DiagramRendererSettings;
  language?: string;
  onDecision: (
    consent: ResolvedDiagramRendererConsent,
  ) => Promise<void>;
  onCancel?: () => void;
  labels?: DiagramRendererConsentPanelLabels;
  autoFocus?: boolean;
}

type DecisionState =
  | { status: 'idle' }
  | { status: 'saving'; consent: ResolvedDiagramRendererConsent }
  | { status: 'failed'; consent: ResolvedDiagramRendererConsent };

/**
 * Accessible inline consent surface shared by preview and export workflows.
 * The caller owns persistence; this component does not report success until
 * the correlated host operation resolves.
 */
export const DiagramRendererConsentPanel: React.FC<DiagramRendererConsentPanelProps> = ({
  settings,
  language = 'diagram',
  onDecision,
  onCancel,
  labels,
  autoFocus = false,
}) => {
  const { t } = useEditorI18n();
  const [state, setState] = useState<DecisionState>({ status: 'idle' });
  const panelRef = useRef<HTMLElement>(null);
  const pendingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const isSaving = state.status === 'saving';

  useEffect(() => {
    if (autoFocus) queueMicrotask(() => panelRef.current?.focus());
  }, [autoFocus]);

  const decide = async (consent: ResolvedDiagramRendererConsent): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setState({ status: 'saving', consent });
    try {
      await onDecision(consent);
      setState({ status: 'idle' });
    } catch {
      setState({ status: 'failed', consent });
    } finally {
      pendingRef.current = false;
    }
  };

  const title = labels?.title ?? t('diagram.consentTitle');
  const description = labels?.description ?? t('diagram.consentDescription', {
    language,
    endpoint: settings.endpoint,
  });

  return (
    <section
      ref={panelRef}
      className="diagram-consent-card"
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={isSaving || undefined}
      tabIndex={autoFocus ? -1 : undefined}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (isSaving) {
          event.preventDefault();
          event.stopPropagation();
        } else if (onCancel) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h4 id={titleId}>{title}</h4>
      <p id={descriptionId}>{description}</p>
      {isSaving && <p role="status">{t('diagram.consentSaving')}</p>}
      {state.status === 'failed' && (
        <p className="diagram-consent-card__error" role="alert">
          {t('diagram.consentFailure')}
        </p>
      )}
      <div className="diagram-consent-card__actions">
        {onCancel && (
          <button type="button" className="btn-secondary" disabled={isSaving} onClick={onCancel}>
            {t('diagram.consentCancel')}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={isSaving}
          onClick={() => void decide('declined')}
        >
          {state.status === 'failed' && state.consent === 'declined'
            ? t('common.retry')
            : t('diagram.consentDecline')}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={isSaving}
          onClick={() => void decide('granted')}
        >
          {state.status === 'failed' && state.consent === 'granted'
            ? t('common.retry')
            : t('diagram.consentGrant')}
        </button>
      </div>
    </section>
  );
};
