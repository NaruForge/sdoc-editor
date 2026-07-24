import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const rootVersion = readJson('package.json').version;
const versions = new Map([
  ['cli/package.json', readJson('cli/package.json').version],
  ['tauri-app/package.json', readJson('tauri-app/package.json').version],
  ['tauri-app/src-tauri/tauri.conf.json', readJson('tauri-app/src-tauri/tauri.conf.json').version],
]);

const cargo = readFileSync('tauri-app/src-tauri/Cargo.toml', 'utf8');
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
versions.set('tauri-app/src-tauri/Cargo.toml', cargoVersion);

const mismatches = [...versions].filter(([, version]) => version !== rootVersion);
if (mismatches.length > 0) {
  for (const [file, version] of mismatches) {
    console.error(`${file}: ${version ?? 'missing'} (expected ${rootVersion})`);
  }
  process.exit(1);
}

console.log(`Versions synchronized at ${rootVersion}`);
