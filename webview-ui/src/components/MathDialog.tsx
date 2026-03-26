import React, { useState, useEffect, useRef } from 'react';
import katex from 'katex';

interface MathDialogProps {
  initialLatex?: string;
  isBlock?: boolean;
  onConfirm: (latex: string, isBlock: boolean) => void;
  onCancel: () => void;
}

const EXAMPLES = [
  { label: 'Fraction', latex: '\\frac{a}{b}' },
  { label: 'Square root', latex: '\\sqrt{x^2 + y^2}' },
  { label: 'Sum', latex: '\\sum_{i=1}^{n} i' },
  { label: 'Integral', latex: '\\int_0^\\infty e^{-x}\\,dx' },
  { label: 'Matrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: 'Limit', latex: '\\lim_{x \\to \\infty} f(x)' },
];

export const MathDialog: React.FC<MathDialogProps> = ({
  initialLatex = '',
  isBlock: initialIsBlock = false,
  onConfirm,
  onCancel,
}) => {
  const [latex, setLatex] = useState(initialLatex);
  const [isBlock, setIsBlock] = useState(initialIsBlock);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    if (initialLatex) {
      textareaRef.current?.select();
    }
  }, []);

  useEffect(() => {
    if (!previewRef.current) return;
    if (!latex.trim()) {
      previewRef.current.innerHTML = '<span style="opacity:0.4;font-style:italic">Type LaTeX to preview...</span>';
      setError(null);
      return;
    }
    try {
      katex.render(latex, previewRef.current, {
        throwOnError: true,
        displayMode: isBlock,
        output: 'htmlAndMathml',
      });
      setError(null);
    } catch (e: any) {
      previewRef.current.innerHTML = `<span style="color:var(--vscode-errorForeground,#f48771);font-size:12px">${e.message}</span>`;
      setError(e.message);
    }
  }, [latex, isBlock]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!latex.trim()) return;
    onConfirm(latex.trim(), isBlock);
  };

  const insertExample = (example: string) => {
    setLatex(example);
    textareaRef.current?.focus();
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content"
        style={{ width: '500px', maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Insert Math Formula</h3>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            type="button"
            onClick={() => setIsBlock(false)}
            className={!isBlock ? 'btn-primary' : 'btn-secondary'}
            style={{ padding: '4px 12px', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '12px' }}
          >
            Inline  <code style={{ opacity: 0.7 }}>$...$</code>
          </button>
          <button
            type="button"
            onClick={() => setIsBlock(true)}
            className={isBlock ? 'btn-primary' : 'btn-secondary'}
            style={{ padding: '4px 12px', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '12px' }}
          >
            Block  <code style={{ opacity: 0.7 }}>$$...$$</code>
          </button>
        </div>

        {/* LaTeX input */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
            LaTeX:
          </label>
          <textarea
            ref={textareaRef}
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            rows={3}
            placeholder="Enter LaTeX, e.g. E = mc^2"
            spellCheck={false}
            style={{
              width: '100%',
              padding: '6px 8px',
              backgroundColor: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: `1px solid ${error ? 'var(--vscode-inputValidation-errorBorder,#f48771)' : 'var(--vscode-input-border)'}`,
              borderRadius: '2px',
              fontSize: '13px',
              fontFamily: 'var(--vscode-editor-font-family, monospace)',
              outline: 'none',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Live preview */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
            Preview:
          </label>
          <div
            ref={previewRef}
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--vscode-input-background)',
              border: '1px solid var(--vscode-input-border)',
              borderRadius: '2px',
              minHeight: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: isBlock ? 'center' : 'flex-start',
              overflowX: 'auto',
            }}
          />
        </div>

        {/* Examples */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
            Examples:
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => insertExample(ex.latex)}
                className="btn-secondary"
                style={{ padding: '3px 8px', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '11px' }}
                title={ex.latex}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button type="button" onClick={onCancel} className="btn-secondary" style={{ padding: '6px 12px', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '13px' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary"
            disabled={!latex.trim()}
            style={{ padding: '6px 12px', border: 'none', borderRadius: '2px', cursor: 'pointer', fontSize: '13px', opacity: latex.trim() ? 1 : 0.5 }}
          >
            Insert  <span style={{ opacity: 0.7, fontSize: '11px' }}>Ctrl+Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
};
