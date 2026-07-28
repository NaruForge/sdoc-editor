import { pathToFileURL } from 'node:url';
import {
  parseArguments,
  ArgumentError,
  type CliArguments,
  type ParsedArguments,
} from './arguments.js';
import { apply, inspect, revisionOf, validate, type CoreResult, type CoreSuccess } from './coreAdapter.js';
import {
  acquireSiblingLock,
  assertCreateDestination,
  assertCreateTargetAvailable,
  atomicCreate,
  atomicReplace,
  IoError,
  MAX_DOCUMENT_BYTES,
  MAX_OPERATIONS_BYTES,
  readLimitedFile,
  readStandardInput,
  resolveCreatePath,
  resolveDocumentPath,
  suggestedSdocPath,
} from './io.js';
import { detectJsonFormat, encodeJson } from './format.js';
import { renderHelp } from './help.js';
import { renderHumanFailure, renderHumanSuccess } from './human.js';
import { createDocumentPlan } from './templateAdapter.js';

declare const __CLI_VERSION__: string | undefined;

const VERSION = typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.6.0';

interface OutputRecord {
  ok: boolean;
  command?: string;
  path?: string;
  preview?: boolean;
  written?: boolean;
  [key: string]: unknown;
}

export interface RunDependencies {
  replaceDocument(path: string, bytes: Uint8Array): Promise<void>;
  createDocument?(path: string, bytes: Uint8Array): Promise<{ cleanupWarning?: string }>;
}

const DEFAULT_DEPENDENCIES: RunDependencies = {
  replaceDocument: atomicReplace,
  createDocument: atomicCreate,
};

function outputMode(args: readonly string[] | CliArguments): 'json' | 'human' {
  if (Array.isArray(args)) {
    return args.includes('--human') && !args.includes('--json') ? 'human' : 'json';
  }
  return (args as CliArguments).output;
}

function writeRecord(
  stream: NodeJS.WritableStream,
  value: OutputRecord,
  mode: 'json' | 'human',
  failure = false,
): void {
  if (mode === 'human') {
    stream.write(`${failure ? renderHumanFailure(value) : renderHumanSuccess(value)}\n`);
  } else {
    stream.write(`${JSON.stringify(value)}\n`);
  }
}

function failure(code: string, message: string): OutputRecord {
  return { ok: false, diagnostics: [{ code, message }] };
}

function exitForResult(result: CoreResult): number {
  if (result.ok) return 0;
  switch (result.category) {
    case 'argument':
      return 2;
    case 'document':
      return 3;
    case 'conflict':
      return 4;
  }
}

function parseJsonUnknown(bytes: Uint8Array, label: string): unknown {
  try {
    const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text) as unknown;
  } catch {
    throw new ArgumentError('CLI_INVALID_JSON', `${label} is not valid JSON`);
  }
}

async function readRequest(args: CliArguments): Promise<unknown> {
  if (args.command === 'rename-heading') {
    return {
      contract: 'sdoc.operations/1',
      expected: { revision: args.expectedRevision },
      operations: [{
        op: 'renameHeading',
        target: { kind: 'id', id: args.id },
        title: args.title,
        ...(args.discardFormatting ? { discardFormatting: true } : {}),
      }],
    };
  }
  if (args.command === 'set-document-title') {
    return {
      contract: 'sdoc.operations/1',
      expected: { revision: args.expectedRevision },
      operations: [{
        op: 'setDocumentTitle',
        title: args.title,
        headingTarget: { kind: 'id', id: args.id, expectedType: 'heading' },
        ...(args.discardFormatting ? { discardFormatting: true } : {}),
      }],
    };
  }
  const bytes =
    args.operationsPath === '-'
      ? await readStandardInput(MAX_OPERATIONS_BYTES)
      : await readLimitedFile(args.operationsPath!, MAX_OPERATIONS_BYTES, 'operation input');
  return parseJsonUnknown(bytes, 'Operation input');
}

function outputDocument(result: CoreResult): unknown {
  if (!result.ok) return undefined;
  return result.envelope ?? result.document ?? result.output;
}

async function runReadCommand(args: CliArguments, path: string, bytes: Uint8Array): Promise<number> {
  const result = args.command === 'inspect'
    ? inspect(bytes, { targetId: args.targetId, targetPath: args.targetPath })
    : validate(bytes);
  if (!result.ok) {
    writeRecord(process.stderr, result as unknown as OutputRecord, args.output, true);
    return exitForResult(result);
  }
  writeRecord(process.stdout, { ...result, command: args.command, path }, args.output);
  return 0;
}

async function applyOnce(
  args: CliArguments,
  path: string,
  bytes: Uint8Array,
  request: unknown,
  operationTime: string,
): Promise<{ result: CoreResult; encoded?: Uint8Array }> {
  const result = apply(bytes, request, {
    upgradeLegacy: args.upgradeLegacy,
    clock: () => operationTime,
  });
  if (!result.ok) return { result };
  const document = outputDocument(result);
  if (result.changed === true && document === undefined) {
    return {
      result: {
        ok: false,
        category: 'document',
        diagnostics: [{ code: 'CLI_MISSING_OUTPUT_DOCUMENT', message: 'Operation core returned no output document' }],
      },
    };
  }
  const encoded = result.changed === true && document !== undefined
    ? encodeJson(document, detectJsonFormat(bytes))
    : bytes;
  return {
    result: {
      ...result,
      outputRevision: revisionOf(encoded),
      path,
    },
    encoded,
  };
}

function publicApplyResult(
  result: CoreSuccess,
  args: CliArguments,
  path: string,
): OutputRecord {
  const { envelope: _envelope, outputText: _outputText, ...summary } = result;
  if (result.legacy !== true || !args.upgradeLegacy || !path.toLowerCase().endsWith('.tiptap.json')) {
    return summary as OutputRecord;
  }
  const existingWarnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  return {
    ...summary,
    warnings: [
      ...existingWarnings,
      {
        code: 'LEGACY_FILE_EXTENSION_RETAINED',
        severity: 'warning',
        message: args.write
          ? 'The file now contains an SDOC envelope but retains its .tiptap.json extension.'
          : 'Writing this preview would store an SDOC envelope under the existing .tiptap.json extension.',
        suggestedPath: suggestedSdocPath(path),
      },
    ],
  } as OutputRecord;
}

async function runApplyCommand(
  args: CliArguments,
  path: string,
  originalBytes: Uint8Array,
  dependencies: RunDependencies,
): Promise<number> {
  const request = await readRequest(args);
  const operationTime = new Date().toISOString();
  const preview = await applyOnce(args, path, originalBytes, request, operationTime);
  if (!preview.result.ok) {
    writeRecord(process.stderr, preview.result as unknown as OutputRecord, args.output, true);
    return exitForResult(preview.result);
  }

  if (!args.write) {
    writeRecord(process.stdout, {
      ...publicApplyResult(preview.result, args, path),
      command: args.command,
      preview: true,
      written: false,
    }, args.output);
    return 0;
  }

  const lock = await acquireSiblingLock(path);
  try {
    const currentBytes = await readLimitedFile(path, MAX_DOCUMENT_BYTES, 'document');
    const committed = await applyOnce(args, path, currentBytes, request, operationTime);
    if (!committed.result.ok) {
      writeRecord(process.stderr, committed.result as unknown as OutputRecord, args.output, true);
      return exitForResult(committed.result);
    }
    if (committed.result.changed === true) {
      await dependencies.replaceDocument(path, committed.encoded!);
    }
    writeRecord(process.stdout, {
      ...publicApplyResult(committed.result, args, path),
      command: args.command,
      preview: false,
      written: committed.result.changed === true,
    }, args.output);
    return 0;
  } finally {
    await lock.release();
  }
}

async function runCreateCommand(
  args: CliArguments,
  dependencies: RunDependencies,
): Promise<number> {
  const path = resolveCreatePath(args.documentPath);
  await assertCreateDestination(path);
  await assertCreateTargetAvailable(path);
  const plan = await createDocumentPlan(path, {
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.template !== undefined ? { template: args.template } : {}),
  });
  const base: OutputRecord = {
    ok: true,
    command: 'create',
    path,
    title: plan.title,
    template: plan.template,
    templateLabel: plan.templateLabel,
    revision: plan.revision,
  };
  if (args.dryRun) {
    writeRecord(process.stdout, { ...base, preview: true, written: false }, args.output);
    return 0;
  }
  const created = await (dependencies.createDocument ?? atomicCreate)(path, plan.bytes);
  const warnings = created.cleanupWarning
    ? [{
      code: 'CLI_TEMP_CLEANUP_FAILED',
      severity: 'warning',
      message: created.cleanupWarning,
    }]
    : [];
  writeRecord(process.stdout, {
    ...base,
    preview: false,
    written: true,
    warnings,
  }, args.output);
  return 0;
}

async function runParsed(
  parsed: ParsedArguments,
  dependencies: RunDependencies,
): Promise<number> {
  if (parsed.kind === 'help') {
    process.stdout.write(`${renderHelp(parsed.command)}\n`);
    return 0;
  }
  if (parsed.command === 'create') return runCreateCommand(parsed, dependencies);
  const path = resolveDocumentPath(parsed.documentPath);
  const bytes = await readLimitedFile(path, MAX_DOCUMENT_BYTES, 'document');
  if (parsed.command === 'inspect' || parsed.command === 'validate') {
    return runReadCommand(parsed, path, bytes);
  }
  return runApplyCommand(parsed, path, bytes, dependencies);
}

export async function run(
  argv: string[],
  dependencies: RunDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const fallbackMode = outputMode(argv);
  try {
    const parsed = parseArguments(argv);
    return await runParsed(parsed, dependencies);
  } catch (error) {
    if (error instanceof ArgumentError) {
      writeRecord(process.stderr, failure(error.code, error.message), fallbackMode, true);
      return 2;
    }
    if (error instanceof IoError) {
      writeRecord(process.stderr, failure(error.code, error.message), fallbackMode, true);
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : 'Unexpected CLI failure';
    writeRecord(process.stderr, failure('CLI_INTERNAL_ERROR', message), fallbackMode, true);
    return 3;
  }
}

const invokedAsMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  process.exitCode = await run(process.argv.slice(2));
}
