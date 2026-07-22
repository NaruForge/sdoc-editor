import React from 'react';

interface EmptyDocumentStateProps {
  onStartBlank: () => void;
  onChooseTemplate: () => void;
}

export const EmptyDocumentState: React.FC<EmptyDocumentStateProps> = ({
  onStartBlank,
  onChooseTemplate,
}) => (
  <main
    aria-labelledby="empty-document-title"
    style={{
      alignItems: 'center',
      display: 'flex',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '32px',
    }}
  >
    <section
      style={{
        background: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border))',
        borderRadius: '8px',
        maxWidth: '560px',
        padding: '32px',
        textAlign: 'center',
        width: '100%',
      }}
    >
      <h1 id="empty-document-title" style={{ marginTop: 0 }}>새 SDOC 문서</h1>
      <p style={{ color: 'var(--vscode-descriptionForeground)', lineHeight: 1.6 }}>
        이 파일은 비어 있습니다. 아래에서 시작 방식을 선택하기 전에는 파일을 변경하지 않습니다.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', marginTop: '24px' }}>
        <button
          type="button"
          onClick={onStartBlank}
          style={{
            background: 'var(--vscode-button-background)',
            border: 0,
            borderRadius: '2px',
            color: 'var(--vscode-button-foreground)',
            cursor: 'pointer',
            padding: '8px 14px',
          }}
        >
          빈 문서로 시작
        </button>
        <button
          type="button"
          onClick={onChooseTemplate}
          style={{
            background: 'var(--vscode-button-secondaryBackground)',
            border: 0,
            borderRadius: '2px',
            color: 'var(--vscode-button-secondaryForeground)',
            cursor: 'pointer',
            padding: '8px 14px',
          }}
        >
          실험적 템플릿 선택…
        </button>
      </div>
    </section>
  </main>
);
