import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const designPath = resolve(repositoryRoot, 'DESIGN.md');
const markdown = await readFile(designPath, 'utf8');
const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
const failures = [];
let relativeLinkCount = 0;

for (const match of markdown.matchAll(markdownLink)) {
  let target = match[1].trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  target = target.split(/\s+["']/u, 1)[0];

  if (target.startsWith('#') || /^(?:https?:|mailto:)/iu.test(target)) continue;
  relativeLinkCount += 1;

  if (target.startsWith('/') || target.includes('\\') || /^[a-z][a-z\d+.-]*:/iu.test(target)) {
    failures.push(`Link must be repository-relative and use forward slashes: ${target}`);
    continue;
  }

  const pathPart = target.split(/[?#]/u, 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    failures.push(`Link contains invalid URI encoding: ${target}`);
    continue;
  }

  const resolvedPath = resolve(dirname(designPath), decodedPath);
  const repositoryRelativePath = relative(repositoryRoot, resolvedPath);
  if (repositoryRelativePath === '..' || repositoryRelativePath.startsWith(`..${sep}`)) {
    failures.push(`Link escapes the repository: ${target}`);
    continue;
  }

  if (!existsSync(resolvedPath)) {
    failures.push(`Link target does not exist: ${target}`);
    continue;
  }

  const targetStats = statSync(resolvedPath);
  if (!targetStats.isFile() && !targetStats.isDirectory()) {
    failures.push(`Link target is not a file or directory: ${target}`);
  }
}

if (relativeLinkCount === 0) failures.push('DESIGN.md must link to at least one repository source of truth.');

if (failures.length > 0) {
  for (const failure of failures) console.error(`design-contract: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`design-contract: resolved ${relativeLinkCount} repository-relative links.`);
}
