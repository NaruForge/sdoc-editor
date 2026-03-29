import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const productName = conf.productName;
const version = conf.version;

const src = resolve(root, 'target', 'release', 'sdoc-editor.exe');
const destDir = resolve(root, 'target', 'release', 'bundle', 'portable');
const dest = resolve(destDir, `${productName}_${version}_x64_portable.exe`);

if (!existsSync(src)) {
  console.error(`❌ 빌드 결과물을 찾을 수 없습니다: ${src}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
cpSync(src, dest);
console.log(`✅ Portable EXE 복사 완료: ${dest}`);
