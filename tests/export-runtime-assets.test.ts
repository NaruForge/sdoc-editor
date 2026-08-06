import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundledExportAssets } from '../src/services/BundledExportAssetService';

describe('bundled export runtime', () => {
  it('loads all runtime assets locally and inlines KaTeX fonts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sdoc-export-assets-'));
    const assets = path.join(root, 'dist', 'export-assets');
    await mkdir(path.join(assets, 'fonts'), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(assets, 'katex.min.css'),
        '@font-face{src:url(fonts/Test.woff2) format("woff2"),url(fonts/Test.woff) format("woff"),url(fonts/Test.ttf) format("truetype")}',
      ),
      writeFile(path.join(assets, 'katex.min.js'), 'katex'),
      writeFile(path.join(assets, 'auto-render.min.js'), 'auto'),
      writeFile(path.join(assets, 'mermaid.min.js'), 'mermaid'),
      writeFile(path.join(assets, 'fonts', 'Test.woff2'), Buffer.from('font')),
    ]);

    const loaded = await loadBundledExportAssets(root);

    expect(loaded.katexCss).toContain('data:font/woff2;base64,Zm9udA==');
    expect(loaded.katexCss).not.toContain('fonts/');
    expect(loaded.katexJs).toBe('katex');
    expect(loaded.autoRenderJs).toBe('auto');
    expect(loaded.mermaidJs).toBe('mermaid');
    expect(JSON.stringify(loaded)).not.toMatch(/https?:\/\//);
  });
});
