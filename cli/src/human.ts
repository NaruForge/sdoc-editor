interface DiagnosticLike {
  code?: unknown;
  message?: unknown;
  severity?: unknown;
}

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function diagnosticsOf(value: Record<string, unknown>): DiagnosticLike[] {
  const diagnostics = value.diagnostics ?? value.warnings;
  return Array.isArray(diagnostics)
    ? diagnostics.filter((item): item is DiagnosticLike =>
      typeof item === 'object' && item !== null)
    : [];
}

function diffLines(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.diff)) return [];
  return value.diff.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const event = item as Record<string, unknown>;
    const kind = stringValue(event.kind) ?? 'change';
    const before = stringValue(event.before);
    const after = stringValue(event.after);
    return [`  - ${kind}${before ? `: ${before}` : ''}${after ? ` -> ${after}` : ''}`];
  });
}

function selectedTargetLine(value: Record<string, unknown>): string | undefined {
  if (typeof value.target !== 'object' || value.target === null) return undefined;
  const selected = value.target as Record<string, unknown>;
  const node = typeof selected.node === 'object' && selected.node !== null
    ? selected.node as Record<string, unknown>
    : {};
  const type = stringValue(node.type) ?? 'block';
  const path = Array.isArray(selected.path) && selected.path.every(
    (item): item is number => Number.isSafeInteger(item) && Number(item) >= 0,
  )
    ? `/${selected.path.join('/')}`
    : undefined;
  const operationTarget = typeof selected.operationTarget === 'object'
    && selected.operationTarget !== null
    ? selected.operationTarget as Record<string, unknown>
    : undefined;
  const id = operationTarget?.kind === 'id' ? stringValue(operationTarget.id) : undefined;
  return `Selected target: ${type}${id ? ` #${id}` : ''}${path ? ` at ${path}` : ''}`;
}

export function renderHumanSuccess(value: Record<string, unknown>): string {
  const command = stringValue(value.command) ?? 'command';
  const lines: string[] = [];
  if (command === 'create') {
    lines.push(value.preview === true ? 'Would create SDOC document' : 'Created SDOC document');
    lines.push(`Path: ${String(value.path ?? '')}`);
    lines.push(`Title: ${String(value.title ?? '')}`);
    lines.push(`Template: ${String(value.templateLabel ?? value.template ?? '')}`);
  } else if (command === 'inspect') {
    lines.push('SDOC inspection');
    lines.push(`Path: ${String(value.path ?? '')}`);
    if (typeof value.metadata === 'object' && value.metadata !== null) {
      const metadata = value.metadata as Record<string, unknown>;
      const title = stringValue(metadata.title);
      if (title) lines.push(`Title: ${title}`);
    }
    const selectedTarget = selectedTargetLine(value);
    if (selectedTarget) lines.push(selectedTarget);
    if (Array.isArray(value.outline) && value.outline.length > 0) {
      lines.push('Outline:');
      for (const item of value.outline) {
        if (typeof item !== 'object' || item === null) continue;
        const outline = item as Record<string, unknown>;
        lines.push(`  - H${String(outline.level ?? '?')} ${String(outline.text ?? '')}`);
      }
    }
    if (Array.isArray(value.blocks)) lines.push(`Blocks: ${value.blocks.length}`);
  } else if (command === 'validate') {
    lines.push('Document is valid');
    lines.push(`Path: ${String(value.path ?? '')}`);
  } else {
    const status = value.preview === true
      ? 'Preview'
      : value.written === true
        ? 'Written'
        : 'No changes';
    lines.push(`${command}: ${status}`);
    lines.push(...diffLines(value));
  }
  if (value.revision !== undefined) lines.push(`Revision: ${String(value.revision)}`);
  if (value.outputRevision !== undefined) lines.push(`Output revision: ${String(value.outputRevision)}`);
  if (value.legacy !== undefined) lines.push(`Legacy: ${String(value.legacy)}`);
  const warnings = diagnosticsOf({ warnings: value.warnings });
  for (const warning of warnings) {
    lines.push(`WARNING ${String(warning.code ?? 'WARNING')}: ${String(warning.message ?? '')}`);
  }
  return lines.join('\n');
}

export function renderHumanFailure(value: Record<string, unknown>): string {
  const diagnostics = diagnosticsOf(value);
  if (diagnostics.length === 0) return 'ERROR CLI_INTERNAL_ERROR: Unexpected CLI failure';
  return diagnostics.map((diagnostic) =>
    `ERROR ${String(diagnostic.code ?? 'CLI_ERROR')}: ${String(diagnostic.message ?? '')}`,
  ).join('\n');
}
