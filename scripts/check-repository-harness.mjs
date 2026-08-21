import { builtinModules } from 'node:module';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const ignoredDirectories = new Set([
  '.git',
  '.vscode-test',
  'coverage',
  'dist',
  'node_modules',
  'output',
  'playwright-report',
  'test-results',
]);

const nodeBuiltins = new Set(
  builtinModules.flatMap((name) => [name, name.replace(/^node:/, ''), `node:${name.replace(/^node:/, '')}`]),
);

function parseRoot(argv) {
  const index = argv.indexOf('--root');
  if (index === -1) return process.cwd();
  if (!argv[index + 1]) throw new Error('--root requires a repository path.');
  return path.resolve(argv[index + 1]);
}

async function walk(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function githubSlug(text) {
  return text
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function markdownAnchors(markdown) {
  const counts = new Map();
  const anchors = new Set();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = githubSlug(match[1]);
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
}

function markdownLinkTargets(markdown) {
  const withoutFences = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
  const links = [];
  const inline = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+['"][^)]*['"])?\s*\)/g;
  const definitions = /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
  for (const match of withoutFences.matchAll(inline)) {
    links.push({ target: match[1] ?? match[2], offset: match.index });
  }
  for (const match of withoutFences.matchAll(definitions)) {
    links.push({ target: match[1] ?? match[2], offset: match.index });
  }
  return links;
}

async function checkAdrs(root, errors) {
  const directory = path.join(root, 'docs', 'adr');
  if (!existsSync(directory)) return;
  const files = (await readdir(directory)).filter((name) => name.endsWith('.md')).sort();
  const identifiers = new Map();

  for (const name of files) {
    const match = /^(\d{4})-.+\.md$/.exec(name);
    if (!match) {
      errors.push(`docs/adr/${name}: ADR filenames must start with a four-digit identifier (for example, 0021-topic.md).`);
      continue;
    }
    const identifier = match[1];
    const group = identifiers.get(identifier) ?? [];
    group.push(name);
    identifiers.set(identifier, group);

    const content = await readFile(path.join(directory, name), 'utf8');
    const heading = /^#\s+ADR\s+(\d{4}):/m.exec(content);
    if (!heading || heading[1] !== identifier) {
      errors.push(`docs/adr/${name}: the first ADR heading must use identifier ${identifier}; rename the file and heading together when correcting an ID.`);
    }
  }

  for (const [identifier, names] of identifiers) {
    if (names.length > 1) {
      errors.push(`docs/adr: duplicate ADR identifier ${identifier}: ${names.join(', ')}. Preserve the earlier decision ID and assign the conflicting decision an unused ID, then update its references.`);
    }
  }
}

async function checkMarkdownLinks(root, files, errors) {
  const markdownFiles = files.filter((file) => file.endsWith('.md'));
  const anchorCache = new Map();

  for (const file of markdownFiles) {
    const markdown = await readFile(file, 'utf8');
    for (const { target: rawTarget, offset } of markdownLinkTargets(markdown)) {
      if (!rawTarget || /^(?:[a-z][a-z\d+.-]*:|#)/i.test(rawTarget)) continue;
      const [rawPath, rawFragment] = rawTarget.split('#', 2);
      if (!rawPath || rawPath.startsWith('/')) continue;

      let decodedPath;
      try {
        decodedPath = decodeURIComponent(rawPath.split('?')[0]);
      } catch {
        errors.push(`${relative(root, file)}:${lineNumber(markdown, offset)}: link path is not valid percent-encoding: ${rawTarget}`);
        continue;
      }

      const target = path.resolve(path.dirname(file), decodedPath);
      if (!existsSync(target)) {
        errors.push(`${relative(root, file)}:${lineNumber(markdown, offset)}: broken repository-relative link ${rawTarget}. Correct the path or remove the stale reference.`);
        continue;
      }

      if (!rawFragment || (await stat(target)).isDirectory() || path.extname(target).toLowerCase() !== '.md') continue;
      let fragment;
      try {
        fragment = decodeURIComponent(rawFragment).replace(/^user-content-/, '').toLocaleLowerCase('en-US');
      } catch {
        errors.push(`${relative(root, file)}:${lineNumber(markdown, offset)}: link fragment is not valid percent-encoding: ${rawTarget}`);
        continue;
      }
      if (!anchorCache.has(target)) anchorCache.set(target, markdownAnchors(await readFile(target, 'utf8')));
      if (!anchorCache.get(target).has(fragment)) {
        errors.push(`${relative(root, file)}:${lineNumber(markdown, offset)}: missing Markdown heading #${rawFragment} in ${relative(root, target)}. Update the fragment to an existing heading.`);
      }
    }
  }
}

async function checkEvergreenKnowledge(root, files, errors) {
  const architecture = path.join(root, 'docs', 'architecture.md');
  if (existsSync(architecture)) {
    const content = await readFile(architecture, 'utf8');
    const patterns = [
      /^Structured Doc Editor v\d+\.\d+\.\d+\s+has\b/im,
      /\bv\d+\.\d+\.\d+\s+(?:build|architecture|verification) contract\b/i,
      /\b(?:current|present)\s+(?:release|version)\s+(?:is\s+)?v\d+\.\d+\.\d+\b/i,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(content);
      if (match) {
        errors.push(`docs/architecture.md:${lineNumber(content, match.index)}: current architecture is coupled to a release version. Describe the state on main with evergreen wording; historical version facts belong in ADRs or release notes.`);
      }
    }
  }

  const packageFile = path.join(root, 'package.json');
  if (!existsSync(packageFile)) return;
  const manifest = JSON.parse(await readFile(packageFile, 'utf8'));
  const configuredReact = manifest.dependencies?.react ?? manifest.devDependencies?.react;
  const reactMajor = configuredReact && /\d+/.exec(configuredReact)?.[0];
  if (!reactMajor) return;

  const currentKnowledgeFiles = files.filter((file) => {
    const name = relative(root, file);
    return name === 'AGENTS.md'
      || name === 'CONTRIBUTING.md'
      || name === 'docs/architecture.md'
      || name === 'eslint.config.mjs'
      || name === '.github/copilot-instructions.md'
      || name.startsWith('.github/instructions/');
  });
  for (const file of currentKnowledgeFiles) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/\bReact\s+(\d+)(?:\.\d+)*\s+(?:application|app|runtime)\b/gi)) {
      if (match[1] !== reactMajor) {
        errors.push(`${relative(root, file)}:${lineNumber(content, match.index)}: says React ${match[1]}, but package.json configures React ${configuredReact}. Update the statement or use evergreen wording.`);
      }
    }
  }
}

function sourceKind(file) {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX
    : file.endsWith('.jsx') ? ts.ScriptKind.JSX
      : file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs') ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
}

function importSpecifiers(file, content) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, sourceKind(file));
  const specifiers = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push({ value: node.moduleSpecifier.text, position: node.moduleSpecifier.getStart(source) });
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteral(node.moduleReference.expression)) {
      specifiers.push({ value: node.moduleReference.expression.text, position: node.moduleReference.expression.getStart(source) });
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push({ value: node.arguments[0].text, position: node.arguments[0].getStart(source) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function sourcePolicyViolations(file, content, options) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, sourceKind(file));
  const syncFilesystemBindings = new Set();
  const filesystemNamespaces = new Set();
  const violations = [];

  const isFilesystemModule = (node) => ts.isStringLiteral(node) && (node.text === 'fs' || node.text === 'node:fs');
  const isFilesystemRequire = (node) => ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'require'
    && node.arguments.length === 1
    && isFilesystemModule(node.arguments[0]);

  function collectFilesystemBindings(node) {
    if (ts.isImportDeclaration(node) && isFilesystemModule(node.moduleSpecifier) && node.importClause) {
      if (node.importClause.name) filesystemNamespaces.add(node.importClause.name.text);
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) filesystemNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (importedName.endsWith('Sync')) syncFilesystemBindings.add(element.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isFilesystemRequire(node.initializer)) {
      if (ts.isIdentifier(node.name)) filesystemNamespaces.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name) ? element.name.text : '';
          if (importedName.endsWith('Sync') && ts.isIdentifier(element.name)) {
            syncFilesystemBindings.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, collectFilesystemBindings);
  }

  collectFilesystemBindings(source);

  function inspect(node) {
    if (options.extensionHost && ts.isCallExpression(node)) {
      const expression = node.expression;
      const directSyncCall = ts.isIdentifier(expression) && syncFilesystemBindings.has(expression.text);
      const namespaceSyncCall = ts.isPropertyAccessExpression(expression)
        && expression.name.text.endsWith('Sync')
        && ((ts.isIdentifier(expression.expression) && filesystemNamespaces.has(expression.expression.text))
          || isFilesystemRequire(expression.expression));
      if (directSyncCall || namespaceSyncCall) {
        violations.push({
          position: expression.getStart(source),
          message: 'extension-host code calls a synchronous filesystem API. Use node:fs/promises or vscode.workspace.fs so normal editor paths do not block the Extension Host.',
        });
      }
    }

    if (options.editorSurface) {
      const ambientProperty = ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'window'
        && node.name.text.startsWith('__');
      const ambientElement = ts.isElementAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'window'
        && node.argumentExpression
        && ts.isStringLiteral(node.argumentExpression)
        && node.argumentExpression.text.startsWith('__');
      if (ambientProperty || ambientElement) {
        violations.push({
          position: node.getStart(source),
          message: 'editor code uses an ambient window.__* bridge. Pass host capabilities through EditorHostBridge or EditorExtensionRuntime with explicit types.',
        });
      }
    }
    ts.forEachChild(node, inspect);
  }

  inspect(source);
  return violations;
}

async function checkArchitectureBoundaries(root, files, errors) {
  const sourceFiles = files.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
  const sharedRoot = path.join(root, 'shared');
  const sharedEditorRoot = path.join(sharedRoot, 'editor');
  const deliveryRoots = [path.join(root, 'src'), path.join(root, 'webview-ui'), path.join(root, 'cli')];
  const extensionRoot = deliveryRoots[0];
  const webviewRoot = deliveryRoots[1];

  for (const file of sourceFiles) {
    const content = await readFile(file, 'utf8');
    const isInside = (directory) => file === directory || file.startsWith(`${directory}${path.sep}`);
    for (const violation of sourcePolicyViolations(file, content, {
      extensionHost: isInside(extensionRoot),
      editorSurface: isInside(sharedEditorRoot) || isInside(webviewRoot),
    })) {
      errors.push(`${relative(root, file)}:${lineNumber(content, violation.position)}: ${violation.message}`);
    }
    for (const { value, position } of importSpecifiers(file, content)) {
      const inShared = isInside(sharedRoot);
      if (inShared && (value === 'vscode' || value.startsWith('vscode/') || nodeBuiltins.has(value))) {
        errors.push(`${relative(root, file)}:${lineNumber(content, position)}: host-neutral shared code imports host API "${value}". Move filesystem/VS Code work to src/, webview-ui/, or cli/ and inject a typed adapter.`);
      }

      if (!value.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), value);
      if (inShared && !(resolved === sharedRoot || resolved.startsWith(`${sharedRoot}${path.sep}`))) {
        errors.push(`${relative(root, file)}:${lineNumber(content, position)}: shared code imports outside shared/ via "${value}". Reverse the dependency and expose the capability through a host-neutral interface.`);
      }

      const owner = deliveryRoots.find(isInside);
      if (owner) {
        const foreign = deliveryRoots.find((candidate) => candidate !== owner && (resolved === candidate || resolved.startsWith(`${candidate}${path.sep}`)));
        if (foreign) {
          errors.push(`${relative(root, file)}:${lineNumber(content, position)}: one delivery surface imports another via "${value}". Move shared semantics to shared/ or keep the integration behind the owning surface.`);
        }
      }
    }
  }
}

async function main() {
  const root = parseRoot(process.argv.slice(2));
  const errors = [];
  const files = await walk(root);
  await checkAdrs(root, errors);
  await checkMarkdownLinks(root, files, errors);
  await checkEvergreenKnowledge(root, files, errors);
  await checkArchitectureBoundaries(root, files, errors);

  if (errors.length > 0) {
    console.error(`Repository harness check failed with ${errors.length} problem(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Repository harness check passed.');
}

main().catch((error) => {
  console.error(`Repository harness check could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
