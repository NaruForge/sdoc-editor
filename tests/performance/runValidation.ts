import { cpus, release, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateEnvelope as detailed } from '../../shared/document/generated/documentValidators.js';
import { validateEnvelope as routed } from '../../shared/document/documentValidation';
import { createAcceptedPerformanceCorpus } from './fixtures';

const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
};
const measure = (operation: () => void) => {
  for (let index = 0; index < 2; index++) operation();
  const time: number[] = [], heap: number[] = [], retained: number[] = [];
  for (let index = 0; index < 7; index++) {
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    operation();
    time.push(performance.now() - start);
    heap.push(process.memoryUsage().heapUsed - before);
    global.gc?.();
    retained.push(process.memoryUsage().heapUsed - before);
  }
  return { milliseconds: summarize(time), heapDeltaBytes: summarize(heap), retainedDeltaBytes: summarize(retained) };
};
const args = process.argv.slice(2);
const before = args.find((value) => value.startsWith('--cli-before='))?.slice('--cli-before='.length);
if (args.some((value) => !value.startsWith('--cli-before='))) throw new Error('Only --cli-before=<bundle> is supported');
mkdirSync('output/validation-performance', { recursive: true });
const results = [];
for (const name of ['text-5k', 'text-25k', 'rich-mixed-5k', 'rich-balanced-5k'] as const) {
  const fixture = createAcceptedPerformanceCorpus(name);
  const input = resolve(`output/validation-performance/${name}.sdoc`);
  writeFileSync(input, fixture.text);
  const cli = (bundle: string) => {
    const time: number[] = [], rss: number[] = [];
    // Import the actual CLI bundle with its normal argv, then collect peak RSS.
    const script = 'import { pathToFileURL } from "node:url"; await import(pathToFileURL(process.argv[1]).href); console.error(JSON.stringify({maxRssKiB:process.resourceUsage().maxRSS}));';
    for (let index = -2; index < 7; index++) {
      const start = performance.now();
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script,
        resolve(bundle), 'validate', input, '--json'], { encoding: 'utf8' });
      const elapsed = performance.now() - start;
      if (child.error) throw child.error;
      if (child.status !== 0) throw new Error(`CLI validation failed: ${child.stderr} ${child.stdout}`);
      const memory: unknown = JSON.parse(child.stderr.trim());
      if (typeof memory !== 'object' || memory === null || !('maxRssKiB' in memory) || typeof memory.maxRssKiB !== 'number') {
        throw new Error('Missing CLI memory sample');
      }
      if (index >= 0) { time.push(elapsed); rss.push(memory.maxRssKiB); }
    }
    return { milliseconds: summarize(time), maxRssKiB: summarize(rss) };
  };
  const validate = (fn: typeof routed) => () => { if (!fn(fixture.envelope)) throw new Error('Valid corpus rejected'); };
  results.push({ corpus: name, bytes: fixture.byteLength, nodes: fixture.nodeCount,
    detailed: measure(validate(detailed)), fastWithFallback: measure(validate(routed)),
    ...(before ? { cliBefore: cli(before) } : {}), cliAfter: cli('cli/dist/sdoc.js') });
}
const report = { environment: { node: process.version, platform: process.platform, os: release(),
  cpu: cpus()[0]?.model, memoryBytes: totalmem() }, warmup: 2, samples: 7,
  note: 'Validator CPU/heap and real CLI validate process latency/peak RSS; GC outside CPU timing. No wall-time gate.', results };
writeFileSync('output/validation-performance/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
