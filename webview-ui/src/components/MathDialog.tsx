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
        className="modal-content modal-content--md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3>Insert Math Formula</h3>

        {/* Mode toggle */}
        <div className="form-group" style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setIsBlock(false)}
            className={`toggle-btn ${!isBlock ? 'btn-primary' : 'btn-secondary'}`}
          >
            Inline  <code className="kbd-hint">$...$</code>
          </button>
          <button
            type="button"
            onClick={() => setIsBlock(true)}
            className={`toggle-btn ${isBlock ? 'btn-primary' : 'btn-secondary'}`}
          >
            Block  <code className="kbd-hint">$$...$$</code>
          </button>
        </div>

        {/* LaTeX input */}
        <div className="form-group">
          <label className="form-label">LaTeX:</label>
          <textarea
            ref={textareaRef}
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            rows={3}
            placeholder="Enter LaTeX, e.g. E = mc^2"
            spellCheck={false}
            className={`form-textarea ${error ? 'form-input--error' : ''}`}
          />
        </div>

        {/* Live preview */}
        <div className="form-group">
          <label className="form-label">Preview:</label>
          <div
            ref={previewRef}
            className="dialog-preview"
            style={{ justifyContent: isBlock ? 'center' : 'flex-start' }}
          />
        </div>

        {/* Examples */}
        <div className="form-group">
          <label className="form-label">Examples:</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => insertExample(ex.latex)}
                className="btn-secondary chip-btn"
                title={ex.latex}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary"
            disabled={!latex.trim()}
          >
            Insert  <span className="kbd-hint">Ctrl+Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
};
