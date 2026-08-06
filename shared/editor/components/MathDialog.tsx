import React, { useState, useEffect, useId, useRef } from 'react';
import katex from 'katex';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';
import { ModalDialog } from './ModalDialog';

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
  const titleId = useId();
  const latexId = useId();
  const previewLabelId = useId();
  const previewId = useId();
  const examplesLabelId = useId();

  useEffect(() => {
    if (initialLatex) queueMicrotask(() => textareaRef.current?.select());
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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
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
    <ModalDialog
      titleId={titleId}
      size="md"
      initialFocusRef={textareaRef}
      onCancel={onCancel}
      onKeyDown={handleKeyDown}
    >
        <h3 id={titleId}>{t('math.insertTitle')}</h3>

        {/* Mode toggle */}
        <div
          className="form-group"
          style={{ display: 'flex', gap: '8px' }}
          role="group"
          aria-label={t('math.displayMode')}
        >
          <button
            type="button"
            onClick={() => setIsBlock(false)}
            className={`toggle-btn ${!isBlock ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={!isBlock}
          >
            {t('math.inline')} <code className="kbd-hint">$...$</code>
          </button>
          <button
            type="button"
            onClick={() => setIsBlock(true)}
            className={`toggle-btn ${isBlock ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={isBlock}
          >
            {t('math.block')} <code className="kbd-hint">$$...$$</code>
          </button>
        </div>

        {/* LaTeX input */}
        <div className="form-group">
          <label htmlFor={latexId} className="form-label">LaTeX:</label>
          <textarea
            ref={textareaRef}
            id={latexId}
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            rows={3}
            placeholder={t('math.latexPlaceholder')}
            spellCheck={false}
            className={`form-textarea ${error ? 'form-input--error' : ''}`}
            aria-invalid={Boolean(error)}
            aria-errormessage={error ? previewId : undefined}
          />
        </div>

        {/* Live preview */}
        <div className="form-group">
          <div id={previewLabelId} className="form-label">{t('diagram.preview')}:</div>
          <div
            ref={previewRef}
            id={previewId}
            className="dialog-preview"
            role={error ? 'alert' : 'status'}
            aria-live="polite"
            aria-labelledby={previewLabelId}
            style={{ justifyContent: isBlock ? 'center' : 'flex-start' }}
          />
        </div>

        {/* Examples */}
        <div className="form-group">
          <div id={examplesLabelId} className="form-label">{t('math.examples')}:</div>
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}
            role="group"
            aria-labelledby={examplesLabelId}
          >
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
    </ModalDialog>
  );
};
