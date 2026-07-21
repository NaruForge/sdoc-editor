import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const defaultRoots = [
  'tauri-app/target/release/bundle/nsis',
  'tauri-app/target/release/bundle/msi',
  'tauri-app/target/release/bundle/portable',
];
const forbidden = [
  'C:\\Users\\',
  '/home/runner/',
  repoRoot,
  homedir(),
  process.env.CARGO_HOME,
  'source.lge.com',
  'CONTROL_NAS',
  'LG Magna e-Powertrain',
  'Legacy Font',
  'com.lgm.sdoc-editor',
].filter((value, index, values) => value && values.indexOf(value) === index);

function collectArtifacts(target, artifacts) {
  let stat;
  try {
    stat = statSync(target);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      collectArtifacts(path.join(target, entry), artifacts);
    }
  } else if (/\.(?:exe|msi)$/i.test(target) && path.basename(target).includes(`_${packageVersion}_`)) {
    artifacts.push(target);
  }
}

function contains(buffer, text, encoding) {
  const needle = Buffer.from(text, encoding);
  return buffer.indexOf(needle) !== -1;
}

const artifacts = [];
for (const input of process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultRoots) {
  collectArtifacts(path.resolve(repoRoot, input), artifacts);
}

if (artifacts.length === 0) {
  throw new Error('No EXE or MSI release artifacts were found to inspect.');
}

const violations = [];
for (const artifact of artifacts.sort()) {
  const bytes = readFileSync(artifact);
  for (const text of forbidden) {
    if (contains(bytes, text, 'utf8') || contains(bytes, text, 'utf16le')) {
      violations.push(`${path.relative(repoRoot, artifact)} contains forbidden text: ${text}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Release artifact hygiene check failed:\n${violations.join('\n')}`);
}

console.log(`Release artifact hygiene check passed for ${artifacts.length} file(s).`);
