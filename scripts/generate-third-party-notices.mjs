import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noticePath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const workspacePackageNames = new Set(
  (rootPackage.workspaces ?? [])
    .map((workspace) => npmPackageMetadata(path.join(repoRoot, workspace)).name)
    .filter(Boolean),
);

const licenseOverrides = new Map([
  // khroma 2.1.0 ships an MIT LICENSE but omits the package.json license field.
  ['npm:khroma@2.1.0', 'MIT'],
]);

const forbiddenLicenses = /\b(?:AGPL|GPL|SSPL|BUSL|OSL)(?:-[\w.-]+)?\b|Commons-Clause|Elastic-2\.0/i;
const knownLicenseIds = new Set([
  '0BSD',
  'Apache-2.0',
  'Artistic-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'LGPL-2.1-or-later',
  'LLVM-exception',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unicode-3.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

function normalize(value) {
  return value.replace(/\r\n/g, '\n');
}

function escapeCell(value) {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function repositoryUrl(value) {
  if (typeof value === 'string') {
    if (value.startsWith('github:')) return `https://github.com/${value.slice('github:'.length)}`;
    if (value.startsWith('git+')) return value.slice('git+'.length).replace(/\.git$/, '');
    if (/^https:\/\//.test(value)) return value.replace(/\.git$/, '');
  }
  if (value && typeof value === 'object' && typeof value.url === 'string') {
    return repositoryUrl(value.url);
  }
  return '';
}

function noticeFiles(packageDirectory) {
  let entries;
  try {
    entries = readdirSync(packageDirectory);
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries.sort()) {
    if (!/^(?:licen[cs]e|copying|notice)(?:[-_.].*)?$/i.test(entry)) continue;
    const file = path.join(packageDirectory, entry);
    try {
      const stat = statSync(file);
      if (!stat.isFile() || stat.size > 512 * 1024) continue;
      const content = readFileSync(file, 'utf8')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim();
      if (content && !content.includes('\0')) results.push({ filename: entry, content });
    } catch {
      // License metadata remains authoritative when an optional notice file is unreadable.
    }
  }
  return results;
}

function npmPackageMetadata(packageDirectory) {
  if (typeof packageDirectory !== 'string') return {};
  try {
    return JSON.parse(readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function licenseIds(expression) {
  return expression
    .replaceAll('(', ' ')
    .replaceAll(')', ' ')
    .replaceAll('/', ' OR ')
    .split(/\s+/)
    .filter((token) => token && token !== 'AND' && token !== 'OR' && token !== 'WITH');
}

function validateLicense(dependency) {
  if (!dependency.license) {
    throw new Error(`${dependency.ecosystem} dependency ${dependency.name}@${dependency.version} has no license metadata.`);
  }
  if (forbiddenLicenses.test(dependency.license)) {
    throw new Error(`${dependency.ecosystem} dependency ${dependency.name}@${dependency.version} uses a forbidden license expression: ${dependency.license}`);
  }
  if (/\bLGPL-[\w.-]+\b/i.test(dependency.license) && !/\bOR\b/.test(dependency.license)) {
    throw new Error(`${dependency.ecosystem} dependency ${dependency.name}@${dependency.version} requires manual LGPL review: ${dependency.license}`);
  }
  const unknown = licenseIds(dependency.license).filter((id) => !knownLicenseIds.has(id));
  if (unknown.length > 0) {
    throw new Error(`${dependency.ecosystem} dependency ${dependency.name}@${dependency.version} has an unreviewed license identifier: ${unknown.join(', ')}`);
  }
}

function collectNpmDependencies() {
  if (!process.env.npm_execpath) {
    throw new Error('Run this generator through `npm run licenses:generate` or `npm run licenses:check`.');
  }
  const raw = execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'ls', '--omit=dev', '--all', '--workspaces', '--include-workspace-root', '--json', '--long'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const root = JSON.parse(raw);
  const dependencies = new Map();

  function visit(node) {
    for (const [fallbackName, dependency] of Object.entries(node.dependencies ?? {})) {
      const metadata = npmPackageMetadata(dependency.path);
      const name = metadata.name ?? dependency.name ?? fallbackName;
      const version = metadata.version ?? dependency.version;
      const source = typeof dependency.resolved === 'string' ? dependency.resolved : '';
      const relativePackagePath = typeof dependency.path === 'string' ? path.relative(repoRoot, dependency.path) : '';
      const isInstalledDependency = relativePackagePath.split(path.sep).includes('node_modules');
      const isWorkspaceDependency = source.startsWith('file:') && workspacePackageNames.has(name);
      if (version && isInstalledDependency && !isWorkspaceDependency) {
        const key = `npm:${name}@${version}`;
        const license = licenseOverrides.get(key) ?? metadata.license ?? dependency.license ?? '';
        const existing = dependencies.get(key);
        if (existing && existing.license !== license) {
          throw new Error(`Conflicting npm license metadata for ${name}@${version}.`);
        }
        dependencies.set(key, {
          ecosystem: 'npm',
          name,
          version,
          license,
          source: repositoryUrl(metadata.repository)
            || repositoryUrl(metadata.homepage)
            || repositoryUrl(source)
            || (/^https:\/\//.test(source) ? source : `https://www.npmjs.com/package/${encodeURIComponent(name)}/v/${version}`),
          noticeFiles: typeof dependency.path === 'string' ? noticeFiles(dependency.path) : [],
        });
      }
      visit(dependency);
    }
  }

  visit(root);
  return [...dependencies.values()];
}

function collectCargoDependencies() {
  const raw = execFileSync(
    'cargo',
    ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'tauri-app/Cargo.toml'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const metadata = JSON.parse(raw);
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set(metadata.workspace_members);
  const pending = [...metadata.workspace_members];
  const dependencies = new Map();

  while (pending.length > 0) {
    const id = pending.pop();
    const node = nodes.get(id);
    if (!node) continue;

    for (const dependency of node.deps) {
      const isRuntimeOrBuild = dependency.dep_kinds.some((kind) => kind.kind !== 'dev');
      if (!isRuntimeOrBuild) continue;
      if (!seen.has(dependency.pkg)) {
        seen.add(dependency.pkg);
        pending.push(dependency.pkg);
      }
      const pkg = packages.get(dependency.pkg);
      if (pkg?.source) {
        const key = `cargo:${pkg.name}@${pkg.version}`;
        dependencies.set(key, {
          ecosystem: 'Cargo',
          name: pkg.name,
          version: pkg.version,
          license: licenseOverrides.get(key) ?? pkg.license ?? '',
          source: repositoryUrl(pkg.repository) || `https://crates.io/crates/${pkg.name}/${pkg.version}`,
          noticeFiles: noticeFiles(path.dirname(pkg.manifest_path)),
        });
      }
    }
  }

  return [...dependencies.values()];
}

function generateNotice() {
  const dependencies = [...collectNpmDependencies(), ...collectCargoDependencies()].sort((left, right) =>
    `${left.ecosystem}\0${left.name}\0${left.version}`.localeCompare(`${right.ecosystem}\0${right.name}\0${right.version}`, 'en'),
  );
  dependencies.forEach(validateLicense);

  const noticeGroups = new Map();
  for (const dependency of dependencies) {
    for (const notice of dependency.noticeFiles) {
      const digest = createHash('sha256').update(notice.content).digest('hex');
      const group = noticeGroups.get(digest) ?? { content: notice.content, packages: new Set(), filenames: new Set() };
      group.packages.add(`${dependency.ecosystem}:${dependency.name}@${dependency.version}`);
      group.filenames.add(notice.filename);
      noticeGroups.set(digest, group);
    }
  }
  const groupedNotices = [...noticeGroups.entries()].sort(([left], [right]) => left.localeCompare(right));

  const lines = [
    '# Third-Party Notices',
    '',
    'Structured Doc Editor includes or builds upon the packages listed below. Each package remains governed by its own license; the project MIT license does not replace those terms.',
    '',
    'This inventory is generated from the installed npm production dependency graph and the locked Cargo runtime/build dependency graph. Regenerate it after dependency changes with `npm run licenses:generate`; CI verifies it with `npm run licenses:check`.',
    '',
    'The inventory links each package source. License and notice files found in installed package distributions are reproduced after the inventory; identical texts are grouped deterministically.',
    '',
    `Dependency count: ${dependencies.length}`,
    '',
    '| Ecosystem | Package | Version | License | Source |',
    '| --- | --- | --- | --- | --- |',
    ...dependencies.map((dependency) =>
      `| ${dependency.ecosystem} | ${escapeCell(dependency.name)} | ${escapeCell(dependency.version)} | ${escapeCell(dependency.license)} | [source](${dependency.source}) |`,
    ),
    '',
    '## Bundled license and notice texts',
    '',
    ...groupedNotices.flatMap(([digest, group], index) => [
      `### Notice group ${index + 1} (${digest.slice(0, 12)})`,
      '',
      `Packages: ${[...group.packages].sort().map((name) => `\`${name}\``).join(', ')}`,
      '',
      `Source filenames: ${[...group.filenames].sort().map((name) => `\`${name}\``).join(', ')}`,
      '',
      '````text',
      group.content,
      '````',
      '',
    ]),
  ];
  return lines.join('\n');
}

const expected = generateNotice();
if (process.argv.includes('--stdout')) {
  process.stdout.write(expected);
} else if (process.argv.includes('--check')) {
  let actual;
  try {
    actual = readFileSync(noticePath, 'utf8');
  } catch {
    throw new Error('THIRD_PARTY_NOTICES.md is missing. Run `npm run licenses:generate`.');
  }
  if (normalize(actual) !== normalize(expected)) {
    throw new Error('THIRD_PARTY_NOTICES.md is stale. Run `npm run licenses:generate`.');
  }
  console.log('Third-party license metadata and notices are up to date.');
} else {
  writeFileSync(noticePath, expected, 'utf8');
  console.log(`Generated ${path.relative(repoRoot, noticePath)}.`);
}
