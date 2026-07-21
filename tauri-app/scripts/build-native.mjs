import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appRoot, '..');
const tauriEntryPoint = resolve(
  workspaceRoot,
  'node_modules',
  '@tauri-apps',
  'cli',
  'tauri.js',
);

const inheritedFlags = process.env.CARGO_ENCODED_RUSTFLAGS
  ? process.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean)
  : [];
const remapFlags = [
  '--remap-path-prefix',
  `${workspaceRoot}=.`,
  '--remap-path-prefix',
  `${homedir()}=<user-home>`,
];

if (process.env.CARGO_HOME) {
  remapFlags.push('--remap-path-prefix', `${resolve(process.env.CARGO_HOME)}=<cargo-home>`);
}

const result = spawnSync(process.execPath, [tauriEntryPoint, 'build'], {
  cwd: appRoot,
  env: {
    ...process.env,
    CARGO_ENCODED_RUSTFLAGS: [...inheritedFlags, ...remapFlags].join('\x1f'),
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to start the Tauri build: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
