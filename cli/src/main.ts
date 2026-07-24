import { pathToFileURL } from 'node:url';
import { parseArguments, ArgumentError, type CliArguments } from './arguments.js';
import { apply, inspect, revisionOf, validate, type CoreResult, type CoreSuccess } from './coreAdapter.js';
import {
  acquireSiblingLock,
  atomicReplace,
  IoError,
  MAX_DOCUMENT_BYTES,
  MAX_OPERATIONS_BYTES,
  readLimitedFile,
  readStandardInput,
  resolveDocumentPath,
} from './io.js';
import { detectJsonFormat, encodeJson } from './format.js';

declare const __CLI_VERSION__: string | undefined;

const VERSION = typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.4.21';

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
}

const DEFAULT_DEPENDENCIES: RunDependencies = {
  replaceDocument: atomicReplace,
};

function writeJson(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
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
      operations: [{ op: 'renameHeading', target: { kind: 'id', id: args.id }, title: args.title }],
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
  const result = args.command === 'inspect' ? inspect(bytes, args.targetId) : validate(bytes);
  if (!result.ok) {
    writeJson(process.stderr, result);
    return exitForResult(result);
  }
  writeJson(process.stdout, { ...result, command: args.command, path });
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

function publicApplyResult(result: CoreSuccess): OutputRecord {
  const { envelope: _envelope, outputText: _outputText, ...summary } = result;
  return summary as OutputRecord;
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
    writeJson(process.stderr, preview.result);
    return exitForResult(preview.result);
  }

  if (!args.write) {
    writeJson(process.stdout, {
      ...publicApplyResult(preview.result),
      command: args.command,
      preview: true,
      written: false,
    });
    return 0;
  }

  const lock = await acquireSiblingLock(path);
  try {
    const currentBytes = await readLimitedFile(path, MAX_DOCUMENT_BYTES, 'document');
    const committed = await applyOnce(args, path, currentBytes, request, operationTime);
    if (!committed.result.ok) {
      writeJson(process.stderr, committed.result);
      return exitForResult(committed.result);
    }
    if (committed.result.changed === true) {
      await dependencies.replaceDocument(path, committed.encoded!);
    }
    writeJson(process.stdout, {
      ...publicApplyResult(committed.result),
      command: args.command,
      preview: false,
      written: committed.result.changed === true,
    });
    return 0;
  } finally {
    await lock.release();
  }
}

export async function run(
  argv: string[],
  dependencies: RunDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  let args: CliArguments;
  try {
    args = parseArguments(argv);
    const path = resolveDocumentPath(args.documentPath);
    const bytes = await readLimitedFile(path, MAX_DOCUMENT_BYTES, 'document');
    if (args.command === 'inspect' || args.command === 'validate') {
      return await runReadCommand(args, path, bytes);
    }
    return await runApplyCommand(args, path, bytes, dependencies);
  } catch (error) {
    if (error instanceof ArgumentError) {
      if (error.code === 'CLI_HELP') {
        process.stdout.write(`${error.message}\n`);
        return 0;
      }
      writeJson(process.stderr, failure(error.code, error.message));
      return 2;
    }
    if (error instanceof IoError) {
      writeJson(process.stderr, failure(error.code, error.message));
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : 'Unexpected CLI failure';
    writeJson(process.stderr, failure('CLI_INTERNAL_ERROR', message));
    return 3;
  }
}

const invokedAsMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  process.exitCode = await run(process.argv.slice(2));
}
