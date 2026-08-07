export const COMMAND_NAMES = [
  'capabilities',
  'inspect',
  'validate',
  'apply',
  'rename-heading',
  'set-document-title',
  'create',
] as const;

export type CommandName = typeof COMMAND_NAMES[number];
export type DocumentCommandName = Exclude<CommandName, 'capabilities'>;

export const READ_PROJECTIONS = ['catalog', 'target', 'section', 'document'] as const;
export const READ_CATALOG_KINDS = ['blocks', 'outline', 'references', 'referenceables'] as const;

export type ReadProjectionArgument = typeof READ_PROJECTIONS[number];
export type ReadCatalogArgument = typeof READ_CATALOG_KINDS[number];

export interface HelpArguments {
  kind: 'help';
  command?: CommandName;
}

interface CommonCliArguments {
  kind: 'command';
  output: 'json' | 'human';
  write: boolean;
  dryRun: boolean;
  upgradeLegacy: boolean;
  discardFormatting: boolean;
  operationsPath?: string;
  targetId?: string;
  targetPath?: number[];
  id?: string;
  title?: string;
  expectedRevision?: string;
  template?: string;
  projection?: ReadProjectionArgument;
  catalog?: ReadCatalogArgument;
  limit?: number;
  cursor?: string;
  maxBytes?: number;
  maxNodes?: number;
  maxSummaryLength?: number;
}

export interface CapabilitiesArguments extends CommonCliArguments {
  command: 'capabilities';
}

export interface DocumentCliArguments extends CommonCliArguments {
  command: DocumentCommandName;
  documentPath: string;
}

export type CliArguments = CapabilitiesArguments | DocumentCliArguments;
export type ParsedArguments = HelpArguments | CliArguments;

export class ArgumentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const COMMANDS = new Set<CommandName>(COMMAND_NAMES);

const OPTIONS = new Set([
  '--json',
  '--human',
  '--write',
  '--dry-run',
  '--upgrade-legacy',
  '--operations',
  '--target-id',
  '--target-path',
  '--id',
  '--title',
  '--expected-revision',
  '--template',
  '--discard-formatting',
  '--projection',
  '--catalog',
  '--limit',
  '--cursor',
  '--max-bytes',
  '--max-nodes',
  '--max-summary-length',
]);
const VALUE_OPTIONS = new Set([
  '--operations',
  '--target-id',
  '--target-path',
  '--id',
  '--title',
  '--expected-revision',
  '--template',
  '--projection',
  '--catalog',
  '--limit',
  '--cursor',
  '--max-bytes',
  '--max-nodes',
  '--max-summary-length',
]);

const ALLOWED_OPTIONS: Record<CommandName, ReadonlySet<string>> = {
  capabilities: new Set(['--json', '--human']),
  inspect: new Set([
    '--json',
    '--human',
    '--target-id',
    '--target-path',
    '--projection',
    '--catalog',
    '--limit',
    '--cursor',
    '--max-bytes',
    '--max-nodes',
    '--max-summary-length',
    '--expected-revision',
  ]),
  validate: new Set(['--json', '--human']),
  apply: new Set(['--json', '--human', '--write', '--dry-run', '--upgrade-legacy', '--operations']),
  'rename-heading': new Set([
    '--json',
    '--human',
    '--write',
    '--dry-run',
    '--upgrade-legacy',
    '--id',
    '--title',
    '--expected-revision',
    '--discard-formatting',
  ]),
  'set-document-title': new Set([
    '--json',
    '--human',
    '--write',
    '--dry-run',
    '--upgrade-legacy',
    '--id',
    '--title',
    '--expected-revision',
    '--discard-formatting',
  ]),
  create: new Set(['--json', '--human', '--dry-run', '--title', '--template']),
};

function commandName(value: string | undefined): CommandName | undefined {
  return value && COMMANDS.has(value as CommandName) ? value as CommandName : undefined;
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ArgumentError('CLI_MISSING_OPTION_VALUE', `${flag} requires a value`);
  }
  return value;
}

function parseTargetPath(value: string): number[] {
  if (!/^\/(?:0|[1-9]\d*)(?:\/(?:0|[1-9]\d*))*$/.test(value)) {
    throw new ArgumentError(
      'CLI_INVALID_TARGET_PATH',
      '--target-path must use slash-separated non-negative content indexes, for example /1/0',
    );
  }
  const path = value.slice(1).split('/').map(Number);
  if (path.length > 128 || !path.every(Number.isSafeInteger)) {
    throw new ArgumentError(
      'CLI_INVALID_TARGET_PATH',
      '--target-path must contain at most 128 safe non-negative integer indexes',
    );
  }
  return path;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ArgumentError(
      'CLI_INVALID_POSITIVE_INTEGER',
      `${flag} must be a positive integer written in base-10 digits`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ArgumentError(
      'CLI_INVALID_POSITIVE_INTEGER',
      `${flag} must be a safe positive integer`,
    );
  }
  return parsed;
}

function parseProjection(value: string): ReadProjectionArgument {
  if (!READ_PROJECTIONS.includes(value as ReadProjectionArgument)) {
    throw new ArgumentError(
      'CLI_INVALID_PROJECTION',
      `--projection must be one of ${READ_PROJECTIONS.join(', ')}`,
    );
  }
  return value as ReadProjectionArgument;
}

function parseCatalog(value: string): ReadCatalogArgument {
  if (!READ_CATALOG_KINDS.includes(value as ReadCatalogArgument)) {
    throw new ArgumentError(
      'CLI_INVALID_CATALOG',
      `--catalog must be one of ${READ_CATALOG_KINDS.join(', ')}`,
    );
  }
  return value as ReadCatalogArgument;
}

function helpArguments(argv: string[]): HelpArguments | undefined {
  const [rawCommand, next, ...remaining] = argv;
  if (!rawCommand || rawCommand === '--help' || rawCommand === '-h') {
    return { kind: 'help' };
  }
  if (rawCommand === 'help') {
    if (remaining.length > 0) {
      throw new ArgumentError('CLI_UNEXPECTED_ARGUMENT', 'help accepts at most one command name');
    }
    if (!next) return { kind: 'help' };
    const topic = commandName(next);
    if (!topic) throw new ArgumentError('CLI_UNKNOWN_COMMAND', `Unknown command: ${next}`);
    return { kind: 'help', command: topic };
  }
  const command = commandName(rawCommand);
  if (command) {
    for (let index = 1; index < argv.length; index += 1) {
      const value = argv[index];
      if (VALUE_OPTIONS.has(value)) {
        index += 1;
        continue;
      }
      if (value === '--help' || value === '-h') return { kind: 'help', command };
    }
  }
  return undefined;
}

export function parseArguments(argv: string[]): ParsedArguments {
  const help = helpArguments(argv);
  if (help) return help;

  const [rawCommand] = argv;
  if (rawCommand === '--version' || rawCommand === '-v') {
    throw new ArgumentError('CLI_VERSION', '');
  }
  const command = commandName(rawCommand);
  if (!command) {
    throw new ArgumentError('CLI_UNKNOWN_COMMAND', `Unknown command: ${rawCommand}`);
  }
  const documentPath = command === 'capabilities' ? undefined : argv[1];
  const rest = command === 'capabilities' ? argv.slice(1) : argv.slice(2);
  if (command !== 'capabilities' && !documentPath) {
    throw new ArgumentError(
      'CLI_MISSING_DOCUMENT',
      command === 'create'
        ? 'A destination .sdoc path is required'
        : 'A .sdoc or .tiptap.json document path is required',
    );
  }

  const common: CommonCliArguments = {
    kind: 'command',
    output: 'json',
    write: false,
    dryRun: false,
    upgradeLegacy: false,
    discardFormatting: false,
  };
  const parsed: CliArguments = command === 'capabilities'
    ? { ...common, command }
    : { ...common, command, documentPath: documentPath! };
  const seen = new Set<string>();

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!OPTIONS.has(flag)) {
      throw new ArgumentError('CLI_UNKNOWN_OPTION', `Unknown option: ${flag}`);
    }
    if (!ALLOWED_OPTIONS[command].has(flag)) {
      throw new ArgumentError('CLI_OPTION_NOT_SUPPORTED', `${command} does not support ${flag}`);
    }
    if (seen.has(flag)) {
      throw new ArgumentError('CLI_DUPLICATE_OPTION', `${flag} may only be specified once`);
    }
    seen.add(flag);

    switch (flag) {
      case '--json':
        parsed.output = 'json';
        break;
      case '--human':
        parsed.output = 'human';
        break;
      case '--write':
        parsed.write = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--upgrade-legacy':
        parsed.upgradeLegacy = true;
        break;
      case '--discard-formatting':
        parsed.discardFormatting = true;
        break;
      case '--operations':
        parsed.operationsPath = valueAfter(rest, index, flag);
        index += 1;
        break;
      case '--target-id':
        parsed.targetId = valueAfter(rest, index, flag);
        index += 1;
        break;
      case '--target-path':
        parsed.targetPath = parseTargetPath(valueAfter(rest, index, flag));
        index += 1;
        break;
      case '--id':
        parsed.id = valueAfter(rest, index, flag);
        index += 1;
        break;
      case '--title':
        parsed.title = valueAfter(rest, index, flag);
        index += 1;
        break;
      case '--expected-revision':
        parsed.expectedRevision = valueAfter(rest, index, flag);
        index += 1;
        break;
      case '--template':
        parsed.template = valueAfter(rest, index, flag);
        index += 1;
        break;
      case '--projection':
        parsed.projection = parseProjection(valueAfter(rest, index, flag));
        index += 1;
        break;
      case '--catalog':
        parsed.catalog = parseCatalog(valueAfter(rest, index, flag));
        index += 1;
        break;
      case '--limit':
        parsed.limit = parsePositiveInteger(valueAfter(rest, index, flag), flag);
        index += 1;
        break;
      case '--cursor':
        parsed.cursor = valueAfter(rest, index, flag);
        index += 1;
        break;
      case '--max-bytes':
        parsed.maxBytes = parsePositiveInteger(valueAfter(rest, index, flag), flag);
        index += 1;
        break;
      case '--max-nodes':
        parsed.maxNodes = parsePositiveInteger(valueAfter(rest, index, flag), flag);
        index += 1;
        break;
      case '--max-summary-length':
        parsed.maxSummaryLength = parsePositiveInteger(valueAfter(rest, index, flag), flag);
        index += 1;
        break;
    }
  }

  if (seen.has('--json') && seen.has('--human')) {
    throw new ArgumentError('CLI_CONFLICTING_OPTIONS', '--json and --human cannot be used together');
  }
  if (parsed.write && parsed.dryRun) {
    throw new ArgumentError('CLI_CONFLICTING_OPTIONS', '--write and --dry-run cannot be used together');
  }
  if (seen.has('--target-id') && seen.has('--target-path')) {
    throw new ArgumentError(
      'CLI_CONFLICTING_OPTIONS',
      '--target-id and --target-path cannot be used together',
    );
  }
  if (parsed.command === 'inspect') {
    const projectionOnlyFlags = [
      '--catalog',
      '--limit',
      '--cursor',
      '--max-bytes',
      '--max-nodes',
      '--max-summary-length',
      '--expected-revision',
    ];
    const firstProjectionOnlyFlag = projectionOnlyFlags.find((flag) => seen.has(flag));
    if (!parsed.projection && firstProjectionOnlyFlag) {
      throw new ArgumentError(
        'CLI_PROJECTION_REQUIRED',
        `${firstProjectionOnlyFlag} requires an explicit --projection`,
      );
    }
    if (parsed.projection) {
      const hasTarget = parsed.targetId !== undefined || parsed.targetPath !== undefined;
      if ((parsed.projection === 'catalog' || parsed.projection === 'document') && hasTarget) {
        throw new ArgumentError(
          'CLI_PROJECTION_FORBIDS_TARGET',
          `${parsed.projection} projection does not accept --target-id or --target-path`,
        );
      }
      if ((parsed.projection === 'target' || parsed.projection === 'section') && !hasTarget) {
        throw new ArgumentError(
          'CLI_PROJECTION_REQUIRES_TARGET',
          `${parsed.projection} projection requires exactly one of --target-id or --target-path`,
        );
      }
      const allowedByProjection: Record<ReadProjectionArgument, ReadonlySet<string>> = {
        catalog: new Set([
          '--catalog', '--limit', '--cursor', '--max-bytes', '--max-summary-length',
          '--expected-revision',
        ]),
        target: new Set(['--max-bytes', '--max-nodes', '--expected-revision']),
        section: new Set(['--cursor', '--max-bytes', '--max-nodes', '--expected-revision']),
        document: new Set(['--cursor', '--max-bytes', '--max-nodes', '--expected-revision']),
      };
      const unsupported = projectionOnlyFlags.find(
        (flag) => seen.has(flag) && !allowedByProjection[parsed.projection!].has(flag),
      );
      if (unsupported) {
        throw new ArgumentError(
          'CLI_PROJECTION_OPTION_NOT_SUPPORTED',
          `${parsed.projection} projection does not support ${unsupported}`,
        );
      }
      if (parsed.expectedRevision !== undefined
        && !/^sha256:[0-9a-f]{64}$/.test(parsed.expectedRevision)) {
        throw new ArgumentError(
          'CLI_INVALID_EXPECTED_REVISION',
          '--expected-revision must be sha256: followed by 64 lowercase hexadecimal digits',
        );
      }
    }
  }
  if (parsed.command === 'apply' && !parsed.operationsPath) {
    throw new ArgumentError('CLI_MISSING_OPERATIONS', 'apply requires --operations <file|->');
  }
  if (parsed.command === 'rename-heading') {
    if (!parsed.id || parsed.title === undefined || !parsed.expectedRevision) {
      throw new ArgumentError(
        'CLI_MISSING_RENAME_ARGUMENT',
        'rename-heading requires --id, --title, and --expected-revision',
      );
    }
  }
  if (parsed.command === 'set-document-title') {
    if (parsed.title === undefined || !parsed.expectedRevision) {
      throw new ArgumentError(
        'CLI_MISSING_SET_DOCUMENT_TITLE_ARGUMENT',
        'set-document-title requires --title and --expected-revision',
      );
    }
    if (parsed.discardFormatting && !parsed.id) {
      throw new ArgumentError(
        'CLI_OPTION_REQUIRES_ID',
        'set-document-title --discard-formatting requires --id because metadata has no formatting',
      );
    }
  }
  return parsed;
}
