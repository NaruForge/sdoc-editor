import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getMermaid } from '../utils/mermaid';

interface DiagramDialogProps {
  initialCode?: string;
  initialLanguage?: string;
  pos: number | null;
  onConfirm: (code: string, language: string, pos: number | null) => void;
  onCancel: () => void;
}

const EXAMPLES = [
  {
    label: 'Flowchart',
    code: `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process 1]
    B -->|No| D[Process 2]
    C --> E[End]
    D --> E`,
  },
  {
    label: 'Sequence',
    code: `sequenceDiagram
    participant A as Client
    participant B as Server
    A->>B: Request
    B-->>A: Response`,
  },
  {
    label: 'Class',
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
    label: 'State',
    code: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : Start
    Processing --> Done : Complete
    Processing --> Error : Fail
    Error --> Idle : Reset
    Done --> [*]`,
  },
  {
    label: 'ER Diagram',
    code: `erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    PRODUCT ||--o{ LINE-ITEM : "ordered in"`,
  },
  {
    label: 'Gantt',
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
      previewRef.current.innerHTML = '<span style="opacity:0.4;font-style:italic">다이어그램 코드를 입력하세요...</span>';
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
        setError(e instanceof Error ? e.message : 'Syntax error');
      }
    }
  }, [language]);

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
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3>
          {pos !== null ? 'Edit Diagram' : 'Insert Diagram'}
          <span className="kbd-hint" style={{ marginLeft: '8px', fontSize: '12px', fontWeight: 'normal' }}>
            ({language})
          </span>
        </h3>

        {/* Examples */}
        <div className="form-group">
          <label className="form-label form-label--sm">Templates:</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => { setCode(ex.code); textareaRef.current?.focus(); }}
                className="btn-secondary chip-btn"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* Editor + Preview split */}
        <div className="dialog-split">
          {/* Code editor */}
          <div className="dialog-split__pane">
            <label className="form-label form-label--sm">Code:</label>
            <textarea
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
            <label className="form-label form-label--sm">Preview:</label>
            <div
              ref={previewRef}
              className="diagram-preview-area dialog-preview dialog-preview--grow"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="modal-actions modal-actions--bordered">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary"
            disabled={!code.trim()}
          >
            {pos !== null ? 'Update' : 'Insert'}
            <span className="kbd-hint" style={{ marginLeft: '6px' }}>Ctrl+Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
};
