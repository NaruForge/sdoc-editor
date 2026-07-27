import type { CommandName } from './arguments.js';

interface CommandHelp {
  usage: string;
  description: string;
  options: readonly string[];
  examples: readonly string[];
}

const COMMON_OUTPUT = [
  '  --json                 Emit the default one-line JSON result',
  '  --human                Emit a human-readable result (not a stable machine API)',
] as const;

const COMMAND_HELP: Record<CommandName, CommandHelp> = {
  inspect: {
    usage: 'sdoc inspect <document.sdoc|document.tiptap.json> [options]',
    description: 'Inspect a document revision, outline, references, and targetable blocks.',
    options: [...COMMON_OUTPUT, '  --target-id <id>       Include the complete node for one persistent ID'],
    examples: [
      'sdoc inspect report.sdoc --json',
      'sdoc inspect report.sdoc --target-id intro --human',
    ],
  },
  validate: {
    usage: 'sdoc validate <document.sdoc|document.tiptap.json> [options]',
    description: 'Validate the persisted document contract and semantic invariants.',
    options: COMMON_OUTPUT,
    examples: ['sdoc validate report.sdoc', 'sdoc validate legacy.tiptap.json --human'],
  },
  apply: {
    usage: 'sdoc apply <document.sdoc|document.tiptap.json> --operations <file|-> [options]',
    description: 'Preview or atomically apply an sdoc.operations/1 request.',
    options: [
      ...COMMON_OUTPUT,
      '  --operations <file|-> Read the operation request from a JSON file or stdin',
      '  --write                Persist the change (preview is the default)',
      '  --dry-run              Explicitly request preview mode',
      '  --upgrade-legacy       Permit conversion of a legacy raw Tiptap document',
    ],
    examples: [
      'sdoc apply report.sdoc --operations operations.json',
      'sdoc apply report.sdoc --operations operations.json --write',
    ],
  },
  'rename-heading': {
    usage: 'sdoc rename-heading <document> --id <id> --title <text> --expected-revision <sha256:...> [options]',
    description: 'Preview or atomically rename one heading by persistent ID.',
    options: [
      ...COMMON_OUTPUT,
      '  --id <id>                    Heading persistent ID',
      '  --title <text>                Replacement plain-text title',
      '  --expected-revision <digest>  Exact revision returned by inspect',
      '  --write                       Persist the change (preview is the default)',
      '  --dry-run                     Explicitly request preview mode',
      '  --upgrade-legacy              Permit conversion of a legacy raw Tiptap document',
    ],
    examples: [
      'sdoc rename-heading report.sdoc --id intro --title "Results" --expected-revision sha256:...',
    ],
  },
  create: {
    usage: 'sdoc create <document.sdoc> [options]',
    description: 'Create a new SDOC document without overwriting an existing path.',
    options: [
      ...COMMON_OUTPUT,
      '  --title <text>          Document title (defaults to the output filename)',
      '  --template <selector>   builtin:* ID or an explicit .sdoc template path',
      '  --dry-run               Validate and preview without creating the file',
    ],
    examples: [
      'sdoc create report.sdoc --title "Quarterly Report"',
      'sdoc create report.sdoc --template builtin:technical-report --dry-run',
    ],
  },
};

export function renderHelp(command?: CommandName): string {
  if (!command) {
    return [
      'Usage: sdoc <command> [options]',
      '',
      'Commands:',
      '  inspect          Inspect document structure and revision',
      '  validate         Validate a document',
      '  apply            Preview or apply semantic operations',
      '  rename-heading   Rename one heading by persistent ID',
      '  create           Create a new document from a built-in or file template',
      '',
      'Use "sdoc help <command>" or "sdoc <command> --help" for command details.',
      'JSON is the default output. Use --human for interactive output.',
      'Exit codes: 0 success, 2 arguments, 3 document, 4 conflict, 5 file I/O.',
    ].join('\n');
  }
  const entry = COMMAND_HELP[command];
  return [
    `Usage: ${entry.usage}`,
    '',
    entry.description,
    '',
    'Options:',
    ...entry.options,
    '  -h, --help             Show this help',
    '',
    'Examples:',
    ...entry.examples.map((example) => `  ${example}`),
    '',
    'Exit codes: 0 success, 2 arguments, 3 document, 4 conflict, 5 file I/O.',
  ].join('\n');
}
