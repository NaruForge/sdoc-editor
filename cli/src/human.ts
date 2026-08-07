interface DiagnosticLike {
  code?: unknown;
  message?: unknown;
  severity?: unknown;
}

interface NodeLike {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: Record<string, unknown>;
}

function extractText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const n = node as NodeLike;
  if (typeof n.text === 'string') return n.text;
  if (!Array.isArray(n.content)) return '';
  return n.content.map(extractText).join('');
}

function nodeContent(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as NodeLike;
  const text = extractText(n);
  if (text.length > 0) return text;
  const attrs = n.attrs;
  const fallback = attrs?.latex ?? attrs?.code ?? attrs?.src ?? attrs?.caption;
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : undefined;
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

function selectedTargetDetailLines(value: Record<string, unknown>): string[] {
  if (typeof value.target !== 'object' || value.target === null) return [];
  const selected = value.target as Record<string, unknown>;
  const content = nodeContent(selected.node);
  const digest = stringValue(selected.digest);
  return [
    ...(content ? [`Content: ${content}`] : []),
    ...(digest ? [`Digest: ${digest}`] : []),
  ];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function projectionContentLines(value: Record<string, unknown>): string[] {
  const projection = stringValue(value.projection);
  const data = recordValue(value.data);
  if (!projection || !data) return [];
  if (projection === 'catalog') {
    const kind = stringValue(data.kind) ?? 'blocks';
    const items = Array.isArray(data.items) ? data.items : [];
    const lines = [`Catalog ${kind}: ${items.length} item${items.length === 1 ? '' : 's'}`];
    for (const item of items.slice(0, 20)) {
      const record = recordValue(item);
      if (!record) continue;
      const description = stringValue(record.summary)
        ?? stringValue(record.text)
        ?? stringValue(record.href)
        ?? stringValue(record.type)
        ?? 'item';
      lines.push(`  - ${description}`);
    }
    if (items.length > 20) lines.push(`  - … ${items.length - 20} more`);
    return lines;
  }
  if (projection === 'target') {
    const selected = { target: data };
    const targetLine = selectedTargetLine(selected);
    return [
      ...(targetLine ? [targetLine] : []),
      ...selectedTargetDetailLines(selected),
    ];
  }
  const content = Array.isArray(data.content) ? data.content : [];
  const label = projection === 'section'
    ? `Section /${Array.isArray(data.path) ? data.path.join('/') : ''}`
    : 'Document content';
  const lines = [`${label}: ${content.length} node${content.length === 1 ? '' : 's'}`];
  for (const node of content.slice(0, 20)) {
    const record = recordValue(node);
    if (!record) continue;
    const type = stringValue(record.type) ?? 'node';
    const text = nodeContent(record);
    lines.push(`  - ${type}${text ? `: ${text}` : ''}`);
  }
  if (content.length > 20) lines.push(`  - … ${content.length - 20} more`);
  return lines;
}

function projectionLines(value: Record<string, unknown>): string[] {
  const projection = stringValue(value.projection);
  if (!projection) return [];
  const page = recordValue(value.page) ?? {};
  const budget = recordValue(value.budget) ?? {};
  const bytes = recordValue(budget.bytes);
  const nodes = recordValue(budget.nodes);
  const budgetParts = [
    ...(bytes ? [`${String(bytes.used ?? 0)}/${String(bytes.max ?? 0)} bytes`] : []),
    ...(nodes ? [`${String(nodes.used ?? 0)}/${String(nodes.max ?? 0)} nodes`] : []),
  ];
  const nextCursor = stringValue(page.nextCursor);
  return [
    `Projection: ${projection}`,
    `Returned: ${String(page.returned ?? 0)}`,
    `Complete: ${String(page.complete ?? false)}`,
    ...(page.truncatedBy === undefined ? [] : [`Truncated by: ${String(page.truncatedBy)}`]),
    ...(budgetParts.length === 0 ? [] : [`Budget: ${budgetParts.join(', ')}`]),
    ...projectionContentLines(value),
    ...(nextCursor ? [`Next cursor: ${nextCursor}`] : []),
  ];
}

export function renderHumanSuccess(value: Record<string, unknown>): string {
  const command = stringValue(value.command) ?? 'command';
  const lines: string[] = [];
  if (command === 'capabilities') {
    lines.push('SDOC CLI capabilities');
    lines.push(`CLI version: ${String(value.cliVersion ?? '')}`);
    if (typeof value.contracts === 'object' && value.contracts !== null) {
      lines.push('Contracts:');
      for (const [name, contract] of Object.entries(value.contracts)) {
        lines.push(`  - ${name}: ${String(contract)}`);
      }
    }
    if (Array.isArray(value.commands)) lines.push(`Commands: ${value.commands.join(', ')}`);
    if (Array.isArray(value.semanticOperations)) {
      lines.push(`Semantic operations: ${value.semanticOperations.join(', ')}`);
    }
    if (Array.isArray(value.projections)) lines.push(`Read projections: ${value.projections.join(', ')}`);
    if (Array.isArray(value.catalogKinds)) lines.push(`Catalog kinds: ${value.catalogKinds.join(', ')}`);
    if (Array.isArray(value.builtInTemplateIds)) {
      lines.push(`Built-in templates: ${value.builtInTemplateIds.join(', ')}`);
    }
  } else if (command === 'create') {
    lines.push(value.preview === true ? 'Would create SDOC document' : 'Created SDOC document');
    lines.push(`Path: ${String(value.path ?? '')}`);
    lines.push(`Title: ${String(value.title ?? '')}`);
    lines.push(`Template: ${String(value.templateLabel ?? value.template ?? '')}`);
  } else if (command === 'inspect') {
    lines.push('SDOC inspection');
    lines.push(`Path: ${String(value.path ?? '')}`);
    if (value.projection !== undefined) {
      lines.push(...projectionLines(value));
    } else if (typeof value.metadata === 'object' && value.metadata !== null) {
      const metadata = value.metadata as Record<string, unknown>;
      const title = stringValue(metadata.title);
      if (title) lines.push(`Title: ${title}`);
      const selectedTarget = selectedTargetLine(value);
      if (selectedTarget) lines.push(selectedTarget);
      lines.push(...selectedTargetDetailLines(value));
      if (Array.isArray(value.outline) && value.outline.length > 0) {
        lines.push('Outline:');
        for (const item of value.outline) {
          if (typeof item !== 'object' || item === null) continue;
          const outline = item as Record<string, unknown>;
          lines.push(`  - H${String(outline.level ?? '?')} ${String(outline.text ?? '')}`);
        }
      }
      if (Array.isArray(value.blocks)) lines.push(`Blocks: ${value.blocks.length}`);
    }
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
