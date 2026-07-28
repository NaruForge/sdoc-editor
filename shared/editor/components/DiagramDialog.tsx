import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createEditorDiagramRendererResolver,
  DiagramRenderCoordinator,
  getKnownDiagramLanguage,
  KNOWN_DIAGRAM_LANGUAGES,
  resolveDiagramLanguage,
  type DiagramRenderState,
  type HostDiagramRenderer,
  type KnownDiagramLanguage,
} from '../diagram';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

interface DiagramDialogProps {
  initialCode?: string;
  initialLanguage?: string;
  pos: number | null;
  onConfirm: (code: string, language: string, pos: number | null) => void;
  onCancel: () => void;
  renderDiagram?: HostDiagramRenderer;
}

interface DiagramExample {
  labelKey: EditorTranslationKey;
  code: string;
}

const MERMAID_EXAMPLES: ReadonlyArray<DiagramExample> = [
  {
    labelKey: 'diagram.exampleFlowchart',
    code: `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process 1]
    B -->|No| D[Process 2]
    C --> E[End]
    D --> E`,
  },
  {
    labelKey: 'diagram.exampleSequence',
    code: `sequenceDiagram
    participant A as Client
    participant B as Server
    A->>B: Request
    B-->>A: Response`,
  },
  {
    labelKey: 'diagram.exampleClass',
    code: `classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +fetch()
    }
    Animal <|-- Dog`,
  },
  {
    labelKey: 'diagram.exampleState',
    code: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : Start
    Processing --> Done : Complete
    Processing --> Error : Fail
    Error --> Idle : Reset
    Done --> [*]`,
  },
  {
    labelKey: 'diagram.exampleEr',
    code: `erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    PRODUCT ||--o{ LINE-ITEM : "ordered in"`,
  },
  {
    labelKey: 'diagram.exampleGantt',
    code: `gantt
    title Project Plan
    dateFormat YYYY-MM-DD
    section Phase 1
    Design    :a1, 2024-01-01, 30d
    Develop   :a2, after a1, 60d
    section Phase 2
    Test      :a3, after a2, 20d
    Deploy    :a4, after a3, 10d`,
  },
];

const EXAMPLES_BY_LANGUAGE: Readonly<
  Partial<Record<KnownDiagramLanguage, ReadonlyArray<DiagramExample>>>
> = {
  mermaid: MERMAID_EXAMPLES,
  plantuml: [{
    labelKey: 'diagram.exampleSequence',
    code: `@startuml
Alice -> Bob: Request
Bob --> Alice: Response
@enduml`,
  }],
  d2: [{
    labelKey: 'diagram.exampleFlowchart',
    code: `Start -> Decision
Decision -> Process: Yes
Decision -> End: No
Process -> End`,
  }],
  graphviz: [{
    labelKey: 'diagram.exampleFlowchart',
    code: `digraph G {
  Start -> Decision
  Decision -> Process [label="Yes"]
  Decision -> End [label="No"]
  Process -> End
}`,
  }],
};

function initialRenderState(language: string, code: string): DiagramRenderState {
  return {
    language,
    code,
    status: 'source-only',
    reason: code.trim() ? 'renderer-unavailable' : 'empty-source',
  };
}

export const DiagramDialog: React.FC<DiagramDialogProps> = ({
  initialCode = '',
  initialLanguage = 'mermaid',
  pos,
  onConfirm,
  onCancel,
  renderDiagram,
}) => {
  const { t } = useEditorI18n();
  const initialResolvedLanguage = resolveDiagramLanguage(initialLanguage);
  const [code, setCode] = useState(initialCode);
  const [language, setLanguage] = useState(initialResolvedLanguage);
  const [renderState, setRenderState] = useState<DiagramRenderState>(
    () => initialRenderState(initialResolvedLanguage, initialCode),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const coordinator = useMemo(() => new DiagramRenderCoordinator({
    resolveRenderer: createEditorDiagramRendererResolver(renderDiagram),
    onStateChange: setRenderState,
  }), [renderDiagram]);
  const knownLanguage = getKnownDiagramLanguage(language);
  const examples = knownLanguage ? EXAMPLES_BY_LANGUAGE[knownLanguage] ?? [] : [];

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    coordinator.setInput(language, code);
  }, [code, coordinator, language]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') onCancel();
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) handleSubmit();
  };

  const handleSubmit = () => {
    if (!code.trim()) return;
    onConfirm(code.trim(), language, pos);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content modal-content--lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagram-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id="diagram-dialog-title">
          {pos !== null ? t('diagram.editTitle') : t('diagram.insertTitle')}
        </h3>

        <div className="form-group">
          <label htmlFor="diagram-language" className="form-label form-label--sm">
            Language:
          </label>
          <select
            id="diagram-language"
            className="form-select"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {!knownLanguage && (
              <option value={language}>{language} (source only)</option>
            )}
            {KNOWN_DIAGRAM_LANGUAGES.map((candidate) => (
              <option key={candidate} value={candidate}>{candidate}</option>
            ))}
          </select>
        </div>

        {examples.length > 0 && (
          <div className="form-group">
            <label className="form-label form-label--sm">{t('diagram.templates')}:</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {examples.map((example) => (
                <button
                  key={`${language}-${example.labelKey}`}
                  type="button"
                  onClick={() => {
                    setCode(example.code);
                    textareaRef.current?.focus();
                  }}
                  className="btn-secondary chip-btn"
                >
                  {t(example.labelKey)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="dialog-split">
          <div className="dialog-split__pane">
            <label htmlFor="diagram-code" className="form-label form-label--sm">
              {t('diagram.code')}:
            </label>
            <textarea
              id="diagram-code"
              ref={textareaRef}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              rows={15}
              spellCheck={false}
              placeholder="graph TD&#10;    A[Start] --> B[End]"
              className="form-textarea form-textarea--code"
            />
          </div>

          <div className="dialog-split__pane">
            <label className="form-label form-label--sm">{t('diagram.preview')}:</label>
            <div
              className="diagram-preview-area dialog-preview dialog-preview--grow"
              role="status"
              aria-live="polite"
              aria-busy={renderState.status === 'loading'}
            >
              {renderState.status === 'loading' && (
                <div className="diagram-placeholder">{t('diagram.preview')}…</div>
              )}
              {renderState.status === 'ready' && renderState.output.kind === 'svg' && (
                <div dangerouslySetInnerHTML={{ __html: renderState.output.markup }} />
              )}
              {renderState.status === 'ready' && renderState.output.kind === 'png' && (
                <img
                  src={renderState.output.dataUrl}
                  alt={renderState.output.alt ?? `${language} diagram preview`}
                />
              )}
              {renderState.status === 'error' && (
                <div className="diagram-error">
                  <div>{renderState.message || t('diagram.syntaxError')}</div>
                  {renderState.retryable && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => coordinator.retry()}
                    >
                      Retry
                    </button>
                  )}
                  <pre data-language={language}><code>{code}</code></pre>
                </div>
              )}
              {renderState.status === 'source-only' && (
                <div>
                  <div className="diagram-placeholder">
                    {renderState.reason === 'empty-source'
                      ? t('diagram.codePlaceholder')
                      : renderState.reason === 'unsupported-language'
                        ? `${language}: source only. You can edit and save the source.`
                        : renderState.detail
                          ?? t('diagram.unsupportedRenderer', { language })}
                  </div>
                  {code.trim() && (
                    <pre data-language={language}><code>{code}</code></pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions modal-actions--bordered">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary"
            disabled={!code.trim()}
          >
            {pos !== null ? t('diagram.update') : t('common.insert')}
            <span className="kbd-hint" style={{ marginLeft: '6px' }}>Ctrl+Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
};
