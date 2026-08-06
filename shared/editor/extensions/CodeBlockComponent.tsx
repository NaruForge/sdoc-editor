import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { DEFAULT_EDITOR_TRANSLATOR } from '../i18n/locale';
import type { EditorExtensionRuntime } from '../extensionRuntime';

const CodeBlockComponent = ({
  node: { attrs: { language: defaultLanguage } },
  updateAttributes,
  extension,
}: NodeViewProps) => {
  const runtime = (extension.options as { runtime?: EditorExtensionRuntime }).runtime;
  const translate = runtime?.translate ?? DEFAULT_EDITOR_TRANSLATOR;
  const languageLabel = translate('diagram.language');
  return (
  <NodeViewWrapper className="code-block">
    <select
      contentEditable={false}
      aria-label={languageLabel}
      spellCheck={false}
      defaultValue={defaultLanguage || 'null'}
      onChange={(e) => updateAttributes({ language: e.target.value === 'null' ? null : e.target.value })}
    >
      <option value="null">{translate('code.languageAuto')}</option>
      <option disabled>—</option>
      {extension.options.lowlight.listLanguages().map((lang: string) => (
        <option key={lang} value={lang}>
          {lang}
        </option>
      ))}
    </select>
    <pre spellCheck={false}>
      <NodeViewContent<'code'> as="code" spellCheck={false} />
    </pre>
  </NodeViewWrapper>
  );
};

export default CodeBlockComponent;
