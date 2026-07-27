import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'node:fs';
import { mirrorArtifact } from '../../scripts/artifact-output.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const workspaceRoot = resolve(root, '..');

const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const productName = conf.productName;
const version = conf.version;

const src = resolve(root, 'target', 'release', 'sdoc-editor.exe');
const destDir = resolve(root, 'target', 'release', 'bundle', 'portable');
const dest = resolve(destDir, `${productName}_${version}_x64_portable.exe`);
const licenseSource = resolve(root, '..', 'LICENSE');
const noticesSource = resolve(root, '..', 'THIRD_PARTY_NOTICES.md');
const fontLicensesSource = resolve(root, '..', 'licenses', 'fonts');
const licenseDest = resolve(destDir, 'LICENSE.txt');
const noticesDest = resolve(destDir, 'THIRD_PARTY_NOTICES.md');
const fontLicensesDest = resolve(destDir, 'FONT_LICENSES');
const archive = resolve(destDir, `${productName}_${version}_x64_portable.zip`);

if (!existsSync(src)) {
  console.error(`❌ 빌드 결과물을 찾을 수 없습니다: ${src}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
cpSync(src, dest);
cpSync(licenseSource, licenseDest);
cpSync(noticesSource, noticesDest);
rmSync(fontLicensesDest, { recursive: true, force: true });
cpSync(fontLicensesSource, fontLicensesDest, { recursive: true });
rmSync(archive, { force: true });

const zip = spawnSync(
  'tar',
  [
    '-a',
    '-c',
    '-f',
    archive,
    '-C',
    destDir,
    basename(dest),
    basename(licenseDest),
    basename(noticesDest),
    basename(fontLicensesDest),
  ],
  { stdio: 'inherit' },
);

if (zip.error || zip.status !== 0) {
  console.error(`Portable archive creation failed: ${zip.error?.message ?? `tar exited with ${zip.status}`}`);
  process.exit(1);
}

for (const artifact of [dest, archive]) {
  mirrorArtifact(workspaceRoot, artifact);
}
for (const bundleType of ['nsis', 'msi']) {
  const bundleDir = resolve(root, 'target', 'release', 'bundle', bundleType);
  if (!existsSync(bundleDir)) continue;
  for (const entry of readdirSync(bundleDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:exe|msi)$/i.test(entry.name)) {
      mirrorArtifact(workspaceRoot, resolve(bundleDir, entry.name));
    }
  }
}

console.log(`Portable archive ready: ${archive}`);
