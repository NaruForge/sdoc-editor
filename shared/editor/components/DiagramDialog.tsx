import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getMermaid } from '../utils/mermaid';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

interface DiagramDialogProps {
  initialCode?: string;
  initialLanguage?: string;
  pos: number | null;
  onConfirm: (code: string, language: string, pos: number | null) => void;
  onCancel: () => void;
}

const EXAMPLES: ReadonlyArray<{ labelKey: EditorTranslationKey; code: string }> = [
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

let previewCounter = 0;

export const DiagramDialog: React.FC<DiagramDialogProps> = ({
  initialCode = '',
  initialLanguage = 'mermaid',
  pos,
  onConfirm,
  onCancel,
}) => {
  const { t } = useEditorI18n();
  const [code, setCode] = useState(initialCode);
  const [language] = useState(initialLanguage);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const renderPreview = useCallback(async (src: string) => {
    if (!previewRef.current) return;
    if (!src.trim()) {
      previewRef.current.textContent = t('diagram.codePlaceholder');
      setError(null);
      return;
    }
    if (language === 'mermaid') {
      const id = `mermaid-preview-${Date.now()}-${previewCounter++}`;
      try {
        const mermaid = await getMermaid();
        const { svg } = await mermaid.render(id, src);
        if (previewRef.current) {
          previewRef.current.innerHTML = svg;
        }
        setError(null);
      } catch (e: unknown) {
        const errEl = document.getElementById(id);
        if (errEl) errEl.remove();
        if (previewRef.current) {
          previewRef.current.innerHTML = '';
        }
        setError(e instanceof Error ? e.message : t('diagram.syntaxError'));
      }
    }
  }, [language, t]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => renderPreview(code), 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [code, renderPreview]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
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
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id="diagram-dialog-title">
          {pos !== null ? t('diagram.editTitle') : t('diagram.insertTitle')}
          <span className="kbd-hint" style={{ marginLeft: '8px', fontSize: '12px', fontWeight: 'normal' }}>
            ({language})
          </span>
        </h3>

        {/* Examples */}
        <div className="form-group">
          <label className="form-label form-label--sm">{t('diagram.templates')}:</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.labelKey}
                type="button"
                onClick={() => { setCode(ex.code); textareaRef.current?.focus(); }}
                className="btn-secondary chip-btn"
              >
                {t(ex.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Editor + Preview split */}
        <div className="dialog-split">
          {/* Code editor */}
          <div className="dialog-split__pane">
            <label htmlFor="diagram-code" className="form-label form-label--sm">{t('diagram.code')}:</label>
            <textarea
              id="diagram-code"
              ref={textareaRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={15}
              spellCheck={false}
              placeholder="graph TD&#10;    A[Start] --> B[End]"
              className={`form-textarea form-textarea--code ${error ? 'form-input--error' : ''}`}
            />
            {error && <div className="form-error">{error}</div>}
          </div>

          {/* Live Preview */}
          <div className="dialog-split__pane">
            <label className="form-label form-label--sm">{t('diagram.preview')}:</label>
            <div
              ref={previewRef}
              className="diagram-preview-area dialog-preview dialog-preview--grow"
            />
          </div>
        </div>

        {/* Actions */}
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
