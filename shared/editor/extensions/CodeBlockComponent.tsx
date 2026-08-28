import { useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { DEFAULT_EDITOR_TRANSLATOR } from '../i18n/locale';
import type { EditorExtensionRuntime } from '../extensionRuntime';

const CodeBlockComponent = ({
  node: { attrs: { language: defaultLanguage } },
  updateAttributes,
  extension,
  editor,
}: NodeViewProps) => {
  const [active, setActive] = useState(false);
  const runtime = (extension.options as { runtime?: EditorExtensionRuntime }).runtime;
  const translate = runtime?.translate ?? DEFAULT_EDITOR_TRANSLATOR;
  const languageLabel = translate('diagram.language');
  const selectedLanguage = defaultLanguage || 'null';
  return (
  <NodeViewWrapper className="code-block">
    <select
      contentEditable={false}
      aria-label={languageLabel}
      spellCheck={false}
      value={selectedLanguage}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      onChange={(event) => {
        if (!editor.isEditable) {
          event.currentTarget.value = selectedLanguage;
          return;
        }
        updateAttributes({ language: event.target.value === 'null' ? null : event.target.value });
      }}
    >
      {active ? (
        <>
          <option value="null">{translate('code.languageAuto')}</option>
          <option disabled>—</option>
          {extension.options.lowlight.listLanguages().map((lang: string) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </>
      ) : (
        <option value={selectedLanguage}>
          {selectedLanguage === 'null' ? translate('code.languageAuto') : selectedLanguage}
        </option>
      )}
    </select>
    <pre spellCheck={false}>
      <NodeViewContent<'code'> as="code" spellCheck={false} />
    </pre>
  </NodeViewWrapper>
  );
};

export default CodeBlockComponent;
