import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required to run the VS Code performance harness');

const reportPath = path.resolve('tests/vscode/artifacts/performance/vscode.json');
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [npmCli, 'run', 'verify:vscode'], {
    cwd: process.cwd(),
    env: { ...process.env, SDOC_VSCODE_PERF_REPORT: reportPath },
    stdio: 'inherit',
  });
  child.on('error', reject);
  child.on('exit', (code) => resolve(code ?? 1));
});

if (exitCode !== 0) process.exit(exitCode);
process.stdout.write(await readFile(reportPath, 'utf8'));
