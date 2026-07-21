import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('bundled editor font system', () => {
  it('loads the two font families from local WOFF2 assets', () => {
    const css = read('shared/editor/styles/fonts.css');

    expect(css).toContain("font-family: 'Pretendard Variable'");
    expect(css).toContain("font-family: 'JetBrains Mono'");
    expect(css).toContain("url('../assets/fonts/PretendardVariable.woff2')");
    expect(css).toContain("url('../assets/fonts/JetBrainsMono-Variable.woff2')");
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('uses sans for document text, mono without ligatures for code, and leaves KaTeX alone', () => {
    const css = read('shared/editor/styles/editor.css');

    expect(css).toMatch(/\.ProseMirror\s*\{[^}]*font-family:\s*var\(--sdoc-font-sans\)/s);
    expect(css).toMatch(/\.ProseMirror code\s*\{[^}]*font-family:\s*var\(--sdoc-font-mono\)/s);
    expect(css).toContain("font-feature-settings: 'liga' 0, 'calt' 0");
    expect(css).not.toMatch(/\.katex[^{}]*\{[^}]*font-family/s);
  });

  it('imports fonts before editor and KaTeX styles in both hosts', () => {
    for (const entry of ['webview-ui/src/main.tsx', 'tauri-app/src/main.tsx']) {
      const source = read(entry);
      expect(source.indexOf("styles/fonts.css")).toBeLessThan(source.indexOf("styles/editor.css"));
      expect(source.indexOf("styles/editor.css")).toBeLessThan(source.indexOf("katex.min.css"));
    }
  });

  it('packages both OFL license files with desktop distributions', () => {
    const config = read('tauri-app/src-tauri/tauri.conf.json');
    const portable = read('tauri-app/scripts/copy-portable.mjs');

    expect(config).toContain('FONT_LICENSES/Pretendard-OFL.txt');
    expect(config).toContain('FONT_LICENSES/JetBrainsMono-OFL.txt');
    expect(portable).toContain("resolve(destDir, 'FONT_LICENSES')");
  });

  it('uses the bundled font system in the VS Code book editor', () => {
    const source = read('src/SdocBookProvider.ts');

    expect(source).toContain("font-src ${webview.cspSource}");
    expect(source).toContain("'PretendardVariable.woff2'");
    expect(source).toContain("'JetBrainsMono-Variable.woff2'");
    expect(source).toContain('font-family: var(--sdoc-font-mono)');
  });
});
