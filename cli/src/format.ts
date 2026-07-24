export interface JsonFormat {
  bom: boolean;
  indent: string | number | undefined;
  eol: '\n' | '\r\n';
  finalNewline: boolean;
}

export function detectJsonFormat(bytes: Uint8Array): JsonFormat {
  const text = Buffer.from(bytes).toString('utf8');
  const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const indentMatch = withoutBom.match(/(?:^|\r?\n)([ \t]+)"/);
  return {
    bom: text.startsWith('\uFEFF'),
    indent: indentMatch?.[1],
    eol: withoutBom.includes('\r\n') ? '\r\n' : '\n',
    finalNewline: /(?:\r\n|\n)$/.test(withoutBom),
  };
}

export function encodeJson(value: unknown, format: JsonFormat): Uint8Array {
  let text = JSON.stringify(value, undefined, format.indent);
  if (format.eol === '\r\n') {
    text = text.replace(/\n/g, '\r\n');
  }
  if (format.finalNewline) {
    text += format.eol;
  }
  if (format.bom) {
    text = `\uFEFF${text}`;
  }
  return Buffer.from(text, 'utf8');
}
