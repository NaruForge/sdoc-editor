export type CommandName = 'inspect' | 'validate' | 'apply' | 'rename-heading';

export interface CliArguments {
  command: CommandName;
  documentPath: string;
  json: boolean;
  write: boolean;
  dryRun: boolean;
  upgradeLegacy: boolean;
  operationsPath?: string;
  targetId?: string;
  id?: string;
  title?: string;
  expectedRevision?: string;
}

export class ArgumentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const COMMANDS = new Set<CommandName>(['inspect', 'validate', 'apply', 'rename-heading']);

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ArgumentError('CLI_MISSING_OPTION_VALUE', `${flag} requires a value`);
  }
  return value;
}

export function parseArguments(argv: string[]): CliArguments {
  const [rawCommand, documentPath, ...rest] = argv;
  if (!rawCommand || rawCommand === '--help' || rawCommand === '-h') {
    throw new ArgumentError('CLI_HELP', 'Usage: sdoc <inspect|validate|apply|rename-heading> <document> [options]');
  }
  if (rawCommand === '--version' || rawCommand === '-v') {
    throw new ArgumentError('CLI_VERSION', '');
  }
  if (!COMMANDS.has(rawCommand as CommandName)) {
    throw new ArgumentError('CLI_UNKNOWN_COMMAND', `Unknown command: ${rawCommand}`);
  }
  if (!documentPath) {
    throw new ArgumentError('CLI_MISSING_DOCUMENT', 'A .sdoc or .tiptap.json document path is required');
  }

  const parsed: CliArguments = {
    command: rawCommand as CommandName,
    documentPath,
    json: false,
    write: false,
    dryRun: false,
    upgradeLegacy: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    switch (flag) {
      case '--json':
        parsed.json = true;
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
      case '--operations':
        parsed.operationsPath = valueAfter(rest, index, flag);
        index += 1;
        break;
      case '--target-id':
        parsed.targetId = valueAfter(rest, index, flag);
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
      default:
        throw new ArgumentError('CLI_UNKNOWN_OPTION', `Unknown option: ${flag}`);
    }
  }

  if (parsed.write && parsed.dryRun) {
    throw new ArgumentError('CLI_CONFLICTING_OPTIONS', '--write and --dry-run cannot be used together');
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
  if ((parsed.command === 'inspect' || parsed.command === 'validate') && parsed.write) {
    throw new ArgumentError('CLI_WRITE_NOT_SUPPORTED', `${parsed.command} does not support --write`);
  }
  return parsed;
}
