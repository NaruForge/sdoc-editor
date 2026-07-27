export type CommandName = 'inspect' | 'validate' | 'apply' | 'rename-heading' | 'create';

export interface HelpArguments {
  kind: 'help';
  command?: CommandName;
}

export interface CliArguments {
  kind: 'command';
  command: CommandName;
  documentPath: string;
  output: 'json' | 'human';
  write: boolean;
  dryRun: boolean;
  upgradeLegacy: boolean;
  operationsPath?: string;
  targetId?: string;
  id?: string;
  title?: string;
  expectedRevision?: string;
  template?: string;
}

export type ParsedArguments = HelpArguments | CliArguments;

export class ArgumentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const COMMANDS = new Set<CommandName>([
  'inspect',
  'validate',
  'apply',
  'rename-heading',
  'create',
]);

const OPTIONS = new Set([
  '--json',
  '--human',
  '--write',
  '--dry-run',
  '--upgrade-legacy',
  '--operations',
  '--target-id',
  '--id',
  '--title',
  '--expected-revision',
  '--template',
]);
const VALUE_OPTIONS = new Set([
  '--operations',
  '--target-id',
  '--id',
  '--title',
  '--expected-revision',
  '--template',
]);

const ALLOWED_OPTIONS: Record<CommandName, ReadonlySet<string>> = {
  inspect: new Set(['--json', '--human', '--target-id']),
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

  const [rawCommand, documentPath, ...rest] = argv;
  if (rawCommand === '--version' || rawCommand === '-v') {
    throw new ArgumentError('CLI_VERSION', '');
  }
  const command = commandName(rawCommand);
  if (!command) {
    throw new ArgumentError('CLI_UNKNOWN_COMMAND', `Unknown command: ${rawCommand}`);
  }
  if (!documentPath) {
    throw new ArgumentError(
      'CLI_MISSING_DOCUMENT',
      command === 'create'
        ? 'A destination .sdoc path is required'
        : 'A .sdoc or .tiptap.json document path is required',
    );
  }

  const parsed: CliArguments = {
    kind: 'command',
    command,
    documentPath,
    output: 'json',
    write: false,
    dryRun: false,
    upgradeLegacy: false,
  };
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
      case '--template':
        parsed.template = valueAfter(rest, index, flag);
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
  return parsed;
}
