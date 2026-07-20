import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

const CodeBlockComponent = ({
  node: { attrs: { language: defaultLanguage } },
  updateAttributes,
  extension,
}: NodeViewProps) => (
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
      <NodeViewContent<'code'> as="code" />
    </pre>
  </NodeViewWrapper>
);

export default CodeBlockComponent;
