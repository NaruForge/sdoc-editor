import React, { useState, useEffect, useRef } from 'react';
import katex from 'katex';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

interface MathDialogProps {
  initialLatex?: string;
  isBlock?: boolean;
  onConfirm: (latex: string, isBlock: boolean) => void;
  onCancel: () => void;
}

const EXAMPLES: ReadonlyArray<{ labelKey: EditorTranslationKey; latex: string }> = [
  { labelKey: 'math.exampleFraction', latex: '\\frac{a}{b}' },
  { labelKey: 'math.exampleSquareRoot', latex: '\\sqrt{x^2 + y^2}' },
  { labelKey: 'math.exampleSum', latex: '\\sum_{i=1}^{n} i' },
  { labelKey: 'math.exampleIntegral', latex: '\\int_0^\\infty e^{-x}\\,dx' },
  { labelKey: 'math.exampleMatrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { labelKey: 'math.exampleLimit', latex: '\\lim_{x \\to \\infty} f(x)' },
];

export const MathDialog: React.FC<MathDialogProps> = ({
  initialLatex = '',
  isBlock: initialIsBlock = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useEditorI18n();
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
  }, [initialLatex]);

  useEffect(() => {
    if (!previewRef.current) return;
    if (!latex.trim()) {
      previewRef.current.textContent = t('math.emptyPreview');
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('math.invalidLatex');
      previewRef.current.textContent = message;
      setError(message);
    }
  }, [latex, isBlock, t]);

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
        role="dialog"
        aria-modal="true"
        aria-labelledby="math-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id="math-dialog-title">{t('math.insertTitle')}</h3>

        {/* Mode toggle */}
        <div className="form-group" style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setIsBlock(false)}
            className={`toggle-btn ${!isBlock ? 'btn-primary' : 'btn-secondary'}`}
          >
            {t('math.inline')} <code className="kbd-hint">$...$</code>
          </button>
          <button
            type="button"
            onClick={() => setIsBlock(true)}
            className={`toggle-btn ${isBlock ? 'btn-primary' : 'btn-secondary'}`}
          >
            {t('math.block')} <code className="kbd-hint">$$...$$</code>
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
            placeholder={t('math.latexPlaceholder')}
            spellCheck={false}
            className={`form-textarea ${error ? 'form-input--error' : ''}`}
          />
        </div>

        {/* Live preview */}
        <div className="form-group">
          <label className="form-label">{t('diagram.preview')}:</label>
          <div
            ref={previewRef}
            className="dialog-preview"
            style={{ justifyContent: isBlock ? 'center' : 'flex-start' }}
          />
        </div>

        {/* Examples */}
        <div className="form-group">
          <label className="form-label">{t('math.examples')}:</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.labelKey}
                type="button"
                onClick={() => insertExample(ex.latex)}
                className="btn-secondary chip-btn"
                title={ex.latex}
              >
                {t(ex.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary"
            disabled={!latex.trim()}
          >
            {t('common.insert')} <span className="kbd-hint">Ctrl+Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
};
