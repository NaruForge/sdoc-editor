import React, { useState, useEffect, useRef, useCallback } from 'react';
import mermaid from 'mermaid';

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
        const { svg } = await mermaid.render(id, src);
        if (previewRef.current) {
          previewRef.current.innerHTML = svg;
        }
        setError(null);
      } catch (e: any) {
        const errEl = document.getElementById(id);
        if (errEl) errEl.remove();
        if (previewRef.current) {
          previewRef.current.innerHTML = '';
        }
        setError(e.message || 'Syntax error');
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
        className="modal-content"
        style={{ width: '800px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 style={{ marginTop: 0, marginBottom: '12px' }}>
          {pos !== null ? 'Edit Diagram' : 'Insert Diagram'}
          <span style={{ marginLeft: '8px', fontSize: '12px', opacity: 0.6, fontWeight: 'normal' }}>
            ({language})
          </span>
        </h3>

        {/* Examples */}
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>
            Templates:
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => { setCode(ex.code); textareaRef.current?.focus(); }}
                className="btn-secondary"
                style={{ padding: '3px 8px', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '11px' }}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* Editor + Preview split */}
        <div style={{ display: 'flex', gap: '12px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Code editor */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <label style={{ marginBottom: '4px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>
              Code:
            </label>
            <textarea
              ref={textareaRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={15}
              spellCheck={false}
              placeholder="graph TD&#10;    A[Start] --> B[End]"
              style={{
                flex: 1,
                width: '100%',
                padding: '8px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: `1px solid ${error ? 'var(--vscode-inputValidation-errorBorder,#f48771)' : 'var(--vscode-input-border)'}`,
                borderRadius: '4px',
                fontSize: '13px',
                fontFamily: 'var(--vscode-editor-font-family, monospace)',
                lineHeight: '1.5',
                outline: 'none',
                resize: 'none',
                boxSizing: 'border-box',
                tabSize: 4,
              }}
            />
            {error && (
              <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--vscode-errorForeground,#f48771)' }}>
                {error}
              </div>
            )}
          </div>

          {/* Live Preview */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <label style={{ marginBottom: '4px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>
              Preview:
            </label>
            <div
              ref={previewRef}
              className="diagram-preview-area"
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: 'var(--vscode-input-background)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '4px',
                overflow: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--vscode-panel-border)' }}>
          <button type="button" onClick={onCancel} className="btn-secondary" style={{ padding: '6px 12px', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '13px' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary"
            disabled={!code.trim()}
            style={{ padding: '6px 12px', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '13px', opacity: code.trim() ? 1 : 0.5 }}
          >
            {pos !== null ? 'Update' : 'Insert'}
            <span style={{ opacity: 0.7, fontSize: '11px', marginLeft: '6px' }}>Ctrl+Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
};
