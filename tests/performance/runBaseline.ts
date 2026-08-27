import { cpus, release, totalmem } from 'node:os';
import { parseDocumentContract } from '../../shared/document/documentContract';
import { normalizeDocument } from '../../shared/document/sdocUtils';
import {
  createPerformanceRecorder,
  type PerformanceMeasurement,
} from '../../shared/performance/instrumentation';
import { createEditorTransactionSample } from './editorTransactionSample';
import {
  acceptedPerformanceCorpusNames,
  createAcceptedPerformanceCorpus,
  PERFORMANCE_FIXTURE_SEED,
  type AcceptedPerformanceCorpus,
  type AcceptedPerformanceCorpusName,
} from './fixtures';

interface BaselineOptions {
  corpora: AcceptedPerformanceCorpusName[];
  samples: number;
  warmup: number;
  json: boolean;
}

interface BaselineSummary {
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
}

interface BaselineResult {
  corpus: AcceptedPerformanceCorpusName;
  axis: AcceptedPerformanceCorpus['axis'];
  phase: string;
  operationCount: number;
  samplesMs: number[];
  summary: BaselineSummary;
}

const parsePositiveInteger = (argument: string, flag: string): number => {
  const value = Number(argument.slice(flag.length));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${flag.slice(0, -1)} must be a positive integer`);
  }
  return value;
};

const parseOptions = (args: readonly string[]): BaselineOptions => {
  let quick = false;
  let json = false;
  let samples: number | undefined;
  let warmup: number | undefined;
  let corpora: AcceptedPerformanceCorpusName[] | undefined;
  const available = new Set(acceptedPerformanceCorpusNames());

  for (const argument of args) {
    if (argument === '--quick') {
      quick = true;
    } else if (argument === '--json') {
      json = true;
    } else if (argument.startsWith('--samples=')) {
      samples = parsePositiveInteger(argument, '--samples=');
    } else if (argument.startsWith('--warmup=')) {
      warmup = parsePositiveInteger(argument, '--warmup=');
    } else if (argument.startsWith('--corpus=')) {
      const requested = argument.slice('--corpus='.length).split(',').filter(Boolean);
      if (requested.length === 0 || requested.some((name) => !available.has(name as AcceptedPerformanceCorpusName))) {
        throw new Error(`--corpus must contain: ${[...available].join(', ')}`);
      }
      corpora = requested as AcceptedPerformanceCorpusName[];
    } else {
      throw new Error(`unknown performance option: ${argument}`);
    }
  }

  return {
    corpora: corpora ?? (quick
      ? ['text-5k', 'structure-10k', 'rich-2k']
      : [...acceptedPerformanceCorpusNames()]),
    samples: samples ?? (quick ? 3 : 7),
    warmup: warmup ?? (quick ? 1 : 2),
    json,
  };
};

const percentile = (sorted: readonly number[], ratio: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];

const summarize = (samples: readonly number[]): BaselineSummary => {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    minMs: sorted[0],
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
    meanMs: samples.reduce((total, sample) => total + sample, 0) / samples.length,
  };
};

const runSamples = (
  corpus: AcceptedPerformanceCorpus,
  phase: string,
  operationCount: number,
  options: BaselineOptions,
  createOperation: () => () => void,
): BaselineResult => {
  for (let index = 0; index < options.warmup; index += 1) createOperation()();
  const samplesMs: number[] = [];
  for (let index = 0; index < options.samples; index += 1) {
    const recorder = createPerformanceRecorder(
      () => performance.now(),
      {
        corpus: corpus.name,
        documentBytes: corpus.byteLength,
        documentNodes: corpus.nodeCount,
        fixtureSeed: corpus.seed,
      },
    );
    recorder.measure(phase, createOperation(), operationCount);
    const measurement: PerformanceMeasurement | undefined = recorder.report().measurements[0];
    if (!measurement || measurement.outcome !== 'ok') {
      throw new Error(`performance phase did not produce a successful measurement: ${phase}`);
    }
    samplesMs.push(measurement.durationMs);
  }
  return {
    corpus: corpus.name,
    axis: corpus.axis,
    phase,
    operationCount,
    samplesMs,
    summary: summarize(samplesMs),
  };
};

const benchmarkCorpus = (
  corpus: AcceptedPerformanceCorpus,
  options: BaselineOptions,
): BaselineResult[] => {
  const results: BaselineResult[] = [];
  results.push(runSamples(corpus, 'parse-json', corpus.byteLength, options, () => () => {
    const parsed = JSON.parse(corpus.text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('JSON parse produced no document');
  }));
  results.push(runSamples(corpus, 'validate-contract', corpus.nodeCount, options, () => () => {
    const parsed = parseDocumentContract(corpus.envelope);
    if (!parsed.ok) throw new Error(`accepted corpus failed validation: ${corpus.name}`);
  }));
  results.push(runSamples(corpus, 'normalize-document', corpus.nodeCount, options, () => () => {
    const normalized = normalizeDocument(corpus.envelope.doc, {
      captionStyle: 'modern',
      captionNumbering: 'sequential',
      equationNumbering: 'sequential',
      headingNumbering: true,
    });
    if (normalized.type !== 'doc') throw new Error('normalization produced no document');
  }));
  results.push(runSamples(corpus, 'serialize-pretty', corpus.byteLength, options, () => () => {
    const serialized = JSON.stringify(corpus.envelope, null, 2);
    if (serialized.length === 0) throw new Error('serialization produced no bytes');
  }));

  if (corpus.axis !== 'rich') {
    results.push(runSamples(
      corpus,
      'editor-ordinary-text-transaction',
      1,
      options,
      () => {
        const sample = createEditorTransactionSample(corpus);
        if (!sample) throw new Error('editor transaction sample was not supported');
        return sample.run;
      },
    ));
  }
  return results;
};

const round = (value: number): number => Number(value.toFixed(3));

const main = (): void => {
  const options = parseOptions(process.argv.slice(2));
  const corpora = options.corpora.map(createAcceptedPerformanceCorpus);
  const results = corpora.flatMap((corpus) => benchmarkCorpus(corpus, options));
  const processors = cpus();
  const report = {
    format: 'sdoc-performance-baseline/1',
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      cpuModel: processors[0]?.model.trim().replace(/\s+/gu, ' ') ?? 'unknown',
      logicalCpuCount: processors.length,
      totalMemoryBytes: totalmem(),
    },
    configuration: {
      fixtureSeed: PERFORMANCE_FIXTURE_SEED,
      samples: options.samples,
      warmup: options.warmup,
      corpora: options.corpora,
    },
    corpora: corpora.map(({ name, axis, seed, topLevelBlocks, nodeCount, byteLength }) => ({
      name, axis, seed, topLevelBlocks, nodeCount, byteLength,
    })),
    benchmarks: results,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('Structured Doc Editor deterministic performance baseline');
  console.log(`seed=${PERFORMANCE_FIXTURE_SEED} samples=${options.samples} warmup=${options.warmup}`);
  console.table(results.map((result) => ({
    corpus: result.corpus,
    axis: result.axis,
    phase: result.phase,
    operations: result.operationCount,
    meanMs: round(result.summary.meanMs),
    medianMs: round(result.summary.medianMs),
    p95Ms: round(result.summary.p95Ms),
  })));
  console.log('Timing thresholds are intentionally not enforced; compare the JSON output on equivalent hardware.');
};

main();
