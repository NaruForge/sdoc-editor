import {
  parseArguments,
  ArgumentError,
  type CliArguments,
  type DocumentCliArguments,
  type ParsedArguments,
} from './arguments.js';
import packageMetadata from '../package.json' with { type: 'json' };
import {
  apply,
  inspect,
  project,
  revisionOf,
  validate,
  type CoreResult,
  type CoreSuccess,
  type ProjectResult,
} from './coreAdapter.js';
import type {
  ProjectDocumentRequest,
  ProjectDocumentSuccess,
  Sha256Digest,
} from '../../shared/document/operations/index.js';
import { capabilitiesRecord } from './capabilities.js';
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
import { parseJsonInput } from './jsonInput.js';
import {
  failureRecord,
  withResponseContract,
  type CliFailureCategory,
  type OutputRecord,
} from './response.js';
import { createDocumentPlan } from './templateAdapter.js';

declare const __CLI_VERSION__: string | undefined;

const VERSION = typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : packageMetadata.version;

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
    stream.write(`${JSON.stringify(withResponseContract(value))}\n`);
  }
}

function exitForResult(result: CoreResult | ProjectResult): number {
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
        ...(args.id === undefined
          ? {}
          : { headingTarget: { kind: 'id', id: args.id, expectedType: 'heading' } }),
        ...(args.discardFormatting ? { discardFormatting: true } : {}),
      }],
    };
  }
  const bytes =
    args.operationsPath === '-'
      ? await readStandardInput(MAX_OPERATIONS_BYTES)
      : await readLimitedFile(args.operationsPath!, MAX_OPERATIONS_BYTES, 'operation input');
  return parseJsonInput(bytes, 'Operation input', {
    invalidUtf8: (message) => new ArgumentError('CLI_INVALID_UTF8', message),
    invalidJson: (message) => new ArgumentError('CLI_INVALID_JSON', message),
  });
}

function outputDocument(result: CoreResult): unknown {
  if (!result.ok) return undefined;
  return result.envelope ?? result.document ?? result.output;
}

async function runReadCommand(
  args: DocumentCliArguments,
  path: string,
  bytes: Uint8Array,
): Promise<number> {
  const result = args.command === 'inspect' && args.projection !== undefined
    ? project(bytes, projectionRequest(args))
    : args.command === 'inspect'
      ? inspect(bytes, { targetId: args.targetId, targetPath: args.targetPath })
      : validate(bytes);
  if (!result.ok) {
    writeRecord(process.stderr, result as unknown as OutputRecord, args.output, true);
    return exitForResult(result);
  }
  if (args.command === 'inspect' && args.projection !== undefined) {
    writeRecord(process.stdout, projectedOutput(result as ProjectDocumentSuccess, path), args.output);
    return 0;
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
  args: DocumentCliArguments,
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
  if (parsed.command === 'capabilities') {
    writeRecord(process.stdout, capabilitiesRecord(VERSION), parsed.output);
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
      writeRecord(
        process.stderr,
        failureRecord('argument', error.code, error.message),
        fallbackMode,
        true,
      );
      return 2;
    }
    if (error instanceof IoError) {
      writeRecord(process.stderr, failureRecord('io', error.code, error.message), fallbackMode, true);
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : 'Unexpected CLI failure';
    const category: CliFailureCategory = 'internal';
    writeRecord(
      process.stderr,
      failureRecord(category, 'CLI_INTERNAL_ERROR', message),
      fallbackMode,
      true,
    );
    return 3;
  }
}

function projectionRequest(args: DocumentCliArguments): ProjectDocumentRequest {
  const expectedRevision = args.expectedRevision as Sha256Digest | undefined;
  const expected = expectedRevision === undefined ? {} : { expectedRevision };
  switch (args.projection) {
    case 'catalog':
      return {
        contract: 'sdoc.read/1',
        projection: args.projection,
        ...expected,
        ...(args.catalog === undefined ? {} : { kind: args.catalog }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
        ...(args.maxSummaryLength === undefined
          ? {} : { maxSummaryLength: args.maxSummaryLength }),
      };
    case 'target':
      return {
        contract: 'sdoc.read/1',
        projection: args.projection,
        ...expected,
        ...(args.targetId !== undefined
          ? { target: { kind: 'id' as const, id: args.targetId } }
          : { targetPath: args.targetPath! }),
        ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
        ...(args.maxNodes === undefined ? {} : { maxNodes: args.maxNodes }),
      };
    case 'section':
      return {
        contract: 'sdoc.read/1',
        projection: args.projection,
        ...expected,
        ...(args.targetId !== undefined
          ? { target: { kind: 'id' as const, id: args.targetId } }
          : { targetPath: args.targetPath! }),
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
        ...(args.maxNodes === undefined ? {} : { maxNodes: args.maxNodes }),
      };
    case 'document':
      return {
        contract: 'sdoc.read/1',
        projection: args.projection,
        ...expected,
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
        ...(args.maxNodes === undefined ? {} : { maxNodes: args.maxNodes }),
      };
    default:
      throw new ArgumentError('CLI_INVALID_PROJECTION', 'An explicit read projection is required');
  }
}

function projectedOutput(
  result: ProjectDocumentSuccess,
  path: string,
): OutputRecord {
  const { contract: readContract, ...projection } = result;
  return {
    ...projection,
    readContract,
    command: 'inspect',
    path,
  };
}
