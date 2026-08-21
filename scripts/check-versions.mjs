import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootArgumentIndex = process.argv.indexOf('--root');
const repositoryRoot = rootArgumentIndex === -1
  ? process.cwd()
  : path.resolve(process.argv[rootArgumentIndex + 1] ?? '');
if (rootArgumentIndex !== -1 && !process.argv[rootArgumentIndex + 1]) {
  throw new Error('--root requires a repository path.');
}

const readJson = (relativePath) => JSON.parse(
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8'),
);
const rootManifest = readJson('package.json');
const webviewManifest = readJson('webview-ui/package.json');
const rootVersion = rootManifest.version;
const versions = new Map([
  ['cli/package.json', readJson('cli/package.json').version],
]);

const mismatches = [...versions].filter(([, version]) => version !== rootVersion);
if (mismatches.length > 0) {
  for (const [file, version] of mismatches) {
    console.error(`${file}: ${version ?? 'missing'} (expected ${rootVersion})`);
  }
  process.exit(1);
}

const tiptapEntries = (dependencies = {}) => new Map(
  Object.entries(dependencies).filter(([name]) => name.startsWith('@tiptap/')),
);
const rootTiptap = tiptapEntries(rootManifest.devDependencies);
const webviewTiptap = tiptapEntries(webviewManifest.dependencies);
const tiptapPackages = new Set([...rootTiptap.keys(), ...webviewTiptap.keys()]);
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const tiptapErrors = [];

for (const packageName of [...tiptapPackages].sort()) {
  const rootRange = rootTiptap.get(packageName);
  const webviewRange = webviewTiptap.get(packageName);
  if (!rootRange) {
    tiptapErrors.push(`${packageName}: missing from root devDependencies`);
  }
  if (!webviewRange) {
    tiptapErrors.push(`${packageName}: missing from webview-ui dependencies`);
  }
  if (rootRange && !exactVersion.test(rootRange)) {
    tiptapErrors.push(`${packageName}: root version ${rootRange} must be exact`);
  }
  if (webviewRange && !exactVersion.test(webviewRange)) {
    tiptapErrors.push(`${packageName}: webview version ${webviewRange} must be exact`);
  }
  if (rootRange && webviewRange && rootRange !== webviewRange) {
    tiptapErrors.push(`${packageName}: root ${rootRange} does not match webview ${webviewRange}`);
  }
}

if (tiptapPackages.size === 0) {
  tiptapErrors.push('no direct @tiptap/* dependencies were found');
}
if (tiptapErrors.length > 0) {
  for (const error of tiptapErrors) console.error(error);
  process.exit(1);
}

const synchronizedTiptapVersions = new Set(rootTiptap.values());
console.log(`Versions synchronized at ${rootVersion}; ${rootTiptap.size} Tiptap packages use ${[...synchronizedTiptapVersions].join(', ')}`);
