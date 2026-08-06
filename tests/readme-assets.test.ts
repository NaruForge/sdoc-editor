import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const assetRecord = readFileSync(resolve(root, 'ASSETS.md'), 'utf8');
const vscodeIgnore = readFileSync(resolve(root, '.vscodeignore'), 'utf8');

const screenshots = [
  {
    path: 'media/readme/vscode-editor-publish-ko-dark.png',
    alt: 'VS Code 확장에서 Publish 패널과 시험·검증 보고서를 함께 연 Structured Doc Editor 어두운 테마 전체 화면',
    sha256: '201e3a02238a0a4ac20a8033e48314224bf59dc7dab2db5d6a6d643ff464bf40',
  },
  {
    path: 'media/readme/vscode-templates-ko-light.png',
    alt: 'VS Code 확장에서 내장 템플릿 목록과 시험·검증 보고서를 함께 연 Structured Doc Editor 밝은 테마 화면',
    sha256: 'd07c5cbe63e0ff66ea4d26aaedf7d30082fa1b547d5c3a9e4f9ca727ff50a949',
  },
];

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe('README product screenshots', () => {
  it.each(screenshots)('keeps $path reviewable and documented', (screenshot) => {
    const absolutePath = resolve(root, screenshot.path);
    expect(existsSync(absolutePath)).toBe(true);

    const bytes = readFileSync(absolutePath);
    expect(pngDimensions(bytes)).toEqual({ width: 1600, height: 900 });
    expect(bytes.byteLength).toBeLessThanOrEqual(750 * 1024);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(screenshot.sha256);

    expect(readme).toContain(
      `<img src="${screenshot.path}" alt="${screenshot.alt}" width="1600">`,
    );
    expect(assetRecord).toContain(`\`${screenshot.path}\``);
    expect(assetRecord).toContain(`\`${screenshot.sha256}\``);
  });

  it('does not retain or reference the retired two-host overview', () => {
    const historicalPath = 'media/readme/editor-overview-ko.png';
    expect(existsSync(resolve(root, historicalPath))).toBe(false);
    expect(readme).not.toContain(historicalPath);
    expect(assetRecord).not.toContain(historicalPath);
  });

  it('keeps screenshots remote and local UI profiles out of the VSIX payload', () => {
    expect(vscodeIgnore).toContain('media/**');
    expect(vscodeIgnore).toContain('!media/sdoc-editor-icon.png');
    expect(vscodeIgnore).toContain('.tmp-sdoc-ui-profile/**');
    expect(vscodeIgnore).not.toContain('!media/readme/');
  });
});
