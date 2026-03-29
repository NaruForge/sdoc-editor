import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';

const CodeBlockComponent = ({
  node: { attrs: { language: defaultLanguage } },
  updateAttributes,
  extension,
}: any) => (
  <NodeViewWrapper className="code-block">
    <select
      contentEditable={false}
      defaultValue={defaultLanguage || 'null'}
      onChange={(e) => updateAttributes({ language: e.target.value === 'null' ? null : e.target.value })}
    >
      <option value="null">auto</option>
      <option disabled>—</option>
      {extension.options.lowlight.listLanguages().map((lang: string) => (
        <option key={lang} value={lang}>
          {lang}
        </option>
      ))}
    </select>
    <pre>
      <NodeViewContent as="code" />
    </pre>
  </NodeViewWrapper>
);

export default CodeBlockComponent;
