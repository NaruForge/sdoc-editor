import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageFile = path.join(root, 'output', `sdoc-editor-cli-${manifest.version}.tgz`);
const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error('npm_execpath is unavailable; run verify:package:cli through npm.');
if (!existsSync(packageFile)) throw new Error(`Expected CLI package does not exist: ${packageFile}`);

function npm(args, options = {}) {
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
}

function assertDocumentTitle(documentPath, title, surface) {
  const document = JSON.parse(readFileSync(documentPath, 'utf8'));
  if (document.meta?.title !== title) {
    throw new Error(`${surface} did not preserve the exact UTF-8 title.`);
  }
}

function verifyWindowsShims(prefix, title) {
  const powershellShim = path.join(prefix, 'sdoc.ps1');
  const commandShim = path.join(prefix, 'sdoc.cmd');
  const powershellScript = path.join(prefix, 'verify-sdoc-shim.ps1');
  const commandScript = path.join(prefix, 'verify-sdoc-shim.cmd');
  writeFileSync(powershellScript, [
    'param([string]$Shim, [string]$DocumentPath, [string]$Title)',
    "$ErrorActionPreference = 'Stop'",
    '& $Shim create $DocumentPath --title $Title --json',
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
  ].join('\r\n'), 'utf8');
  writeFileSync(commandScript, [
    '@echo off',
    'call "%SDOC_TEST_SHIM%" create "%SDOC_TEST_DOCUMENT%" --title "%SDOC_TEST_TITLE%" --json',
    'exit /b %errorlevel%',
  ].join('\r\n'), 'utf8');

  for (const [executable, label, documentName] of [
    ['pwsh.exe', 'PowerShell 7 shim', 'utf8-pwsh.sdoc'],
    ['powershell.exe', 'Windows PowerShell 5.1 shim', 'utf8-windows-powershell.sdoc'],
  ]) {
    const documentPath = path.join(prefix, documentName);
    execFileSync(executable, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', powershellScript, powershellShim, documentPath, title,
    ], { stdio: 'inherit' });
    assertDocumentTitle(documentPath, title, label);
  }

  const commandDocument = path.join(prefix, 'utf8-cmd.sdoc');
  execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', commandScript], {
    env: {
      ...process.env,
      SDOC_TEST_SHIM: commandShim,
      SDOC_TEST_DOCUMENT: commandDocument,
      SDOC_TEST_TITLE: title,
    },
    stdio: 'inherit',
  });
  assertDocumentTitle(commandDocument, title, 'cmd.exe shim');
}

npm(['exec', '--no', '--offline', '--package=sdoc-editor-cli', '--', 'sdoc', '--version']);
execFileSync(process.execPath, [path.join(root, 'node_modules', 'sdoc-editor-cli', 'dist', 'sdoc.js'), '--version'], {
  cwd: root,
  stdio: 'inherit',
});
npm(['pack', '--dry-run', '--json', './cli']);

const prefix = mkdtempSync(path.join(tmpdir(), 'sdoc-cli-package-'));
try {
  npm(['install', '--global', '--prefix', prefix, packageFile]);
  const globalModules = npm(['root', '--global', '--prefix', prefix]).trim();
  const installedEntry = path.join(globalModules, 'sdoc-editor-cli', 'dist', 'sdoc.js');
  const version = execFileSync(process.execPath, [installedEntry, '--version'], { encoding: 'utf8' }).trim();
  if (version !== manifest.version) {
    throw new Error(`Installed CLI reported ${version}; expected ${manifest.version}.`);
  }

  const title = '한글 제목';
  const documentPath = path.join(prefix, 'utf8-smoke.sdoc');
  execFileSync(process.execPath, [installedEntry, 'create', documentPath, '--title', title, '--json'], {
    stdio: 'inherit',
  });
  assertDocumentTitle(documentPath, title, 'Installed CLI entry point');

  if (process.platform === 'win32') {
    verifyWindowsShims(prefix, title);
  } else {
    execFileSync(path.join(prefix, 'bin', 'sdoc'), ['--version'], { stdio: 'inherit' });
  }
} finally {
  rmSync(prefix, { recursive: true, force: true });
}

console.log('CLI package install and UTF-8 smoke checks passed.');
