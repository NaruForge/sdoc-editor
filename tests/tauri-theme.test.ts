import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import {
  applyColorTheme,
  initializeSystemTheme,
  preferredColorTheme,
  type ThemeRuntime,
} from '../tauri-app/src/theme';

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const channels = hex.match(/[a-f\d]{2}/gi);
    if (!channels || channels.length !== 3) {
      throw new Error(`Expected a six-digit hex color, received ${hex}`);
    }
    const [red, green, blue] = channels.map((channel) => channelLuminance(Number.parseInt(channel, 16)));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseTokens(cssBlock: string): Record<string, string> {
  return Object.fromEntries(
    [...cssBlock.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})\s*;/gi)]
      .map((match) => [match[1], match[2]]),
  );
}

function readRepositoryFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

function selectorsIn(stylesheet: string): Set<string> {
  const selectors = new Set<string>();
  postcss.parse(stylesheet).walkRules((rule) => {
    for (const selector of rule.selectors) selectors.add(selector.trim());
  });
  return selectors;
}

function tokensForSelector(stylesheet: string, selector: string): Record<string, string> {
  const rule = postcss.parse(stylesheet).nodes.find(
    (node) => node.type === 'rule' && node.selector === selector,
  );
  return Object.fromEntries(
    rule?.nodes.flatMap((node) => (
      node.type === 'decl' && /^#[a-f\d]{6}$/iu.test(node.value)
        ? [[node.prop.replace(/^--/u, ''), node.value]]
        : []
    )) ?? [],
  );
}

function createRuntime(options?: {
  prefersDark?: boolean;
  nativeTheme?: 'light' | 'dark' | null;
  nativeFailure?: boolean;
}) {
  const root = { dataset: {} as DOMStringMap };
  let mediaListener: ((event: MediaQueryListEvent) => void) | undefined;
  let nativeListener: ((event: { payload: 'light' | 'dark' }) => void) | undefined;
  const removeMediaListener = vi.fn();
  const unlistenNative = vi.fn();
  const runtime: ThemeRuntime = {
    root,
    mediaQuery: {
      matches: options?.prefersDark ?? false,
      addEventListener: (_type, listener) => {
        mediaListener = listener;
      },
      removeEventListener: (_type, listener) => {
        removeMediaListener(listener);
      },
    },
    loadTauriWindow: async () => {
      if (options?.nativeFailure) {
        throw new Error('not running under Tauri');
      }
      return {
        theme: async () => options?.nativeTheme ?? null,
        onThemeChanged: async (listener) => {
          nativeListener = listener;
          return unlistenNative;
        },
      };
    },
  };
  return {
    root,
    runtime,
    removeMediaListener,
    unlistenNative,
    dispatchMediaTheme(prefersDark: boolean) {
      mediaListener?.({ matches: prefersDark } as MediaQueryListEvent);
    },
    dispatchNativeTheme(theme: 'light' | 'dark') {
      nativeListener?.({ payload: theme });
    },
  };
}

describe('Tauri system theme', () => {
  it('maps the system preference and applies it to the root element', () => {
    expect(preferredColorTheme(false)).toBe('light');
    expect(preferredColorTheme(true)).toBe('dark');

    const root = { dataset: {} as DOMStringMap };
    applyColorTheme(root, 'light');
    expect(root.dataset.theme).toBe('light');
  });

  it('uses the native theme and follows native theme changes', async () => {
    const harness = createRuntime({ prefersDark: false, nativeTheme: 'dark' });
    const dispose = await initializeSystemTheme(harness.runtime);

    expect(harness.root.dataset.theme).toBe('dark');
    harness.dispatchNativeTheme('light');
    expect(harness.root.dataset.theme).toBe('light');

    dispose();
    expect(harness.unlistenNative).toHaveBeenCalledOnce();
  });

  it('keeps the preference fallback live when the Tauri API is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createRuntime({ prefersDark: true, nativeFailure: true });
    const dispose = await initializeSystemTheme(harness.runtime);

    expect(harness.root.dataset.theme).toBe('dark');
    harness.dispatchMediaTheme(false);
    expect(harness.root.dataset.theme).toBe('light');

    dispose();
    expect(harness.removeMediaListener).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('keeps core text and controls above WCAG contrast thresholds', () => {
    const stylesheet = readRepositoryFile('tauri-app/src/styles/tauri-theme.css');
    const darkTokens = tokensForSelector(stylesheet, ":root:not([data-host='vscode'])");
    const lightTokens = tokensForSelector(
      stylesheet,
      ":root:not([data-host='vscode'])[data-theme='light']",
    );

    for (const tokens of [darkTokens, lightTokens]) {
      expect(contrastRatio(tokens['editor-fg'], tokens['editor-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens['description-fg'], tokens['editor-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens['input-placeholder'], tokens['input-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens['button-fg'], tokens['button-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens['panel-border'], tokens['editor-bg'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tokens['focus-border'], tokens['editor-bg'])).toBeGreaterThanOrEqual(3);
    }
  });

  it('loads shared structural CSS before host theme CSS in production and UI fixtures', () => {
    for (const relativePath of ['tauri-app/src/main.tsx', 'tests/ui/src/main.tsx']) {
      const source = readRepositoryFile(relativePath);
      expect(source.indexOf("@shared/editor/styles/fonts.css")).toBeLessThan(
        source.indexOf("@shared/editor/styles/editor.css"),
      );
      expect(source.indexOf("@shared/editor/styles/editor.css")).toBeLessThan(
        source.indexOf("tauri-theme.css"),
      );
    }
  });

  it('does not redefine shared structural selectors in the Tauri theme layer', () => {
    const sharedSelectors = selectorsIn(readRepositoryFile('shared/editor/styles/editor.css'));
    const tauriSelectors = selectorsIn(readRepositoryFile('tauri-app/src/styles/tauri-theme.css'));
    const overlap = [...tauriSelectors].filter((selector) => sharedSelectors.has(selector)).sort();
    expect(overlap).toEqual([]);
  });

  it('defines every VS Code theme variable used by shared CSS in the UI fixture', () => {
    const sharedStyles = readRepositoryFile('shared/editor/styles/editor.css');
    const harnessStyles = readRepositoryFile('tests/ui/src/harness.css');
    const referencedVariables = new Set(
      [...sharedStyles.matchAll(/var\((--vscode-[\w-]+)/gu)].map((match) => match[1]),
    );
    const declaredVariables = new Set<string>();
    postcss.parse(harnessStyles).walkDecls(/^--vscode-/u, (declaration) => {
      declaredVariables.add(declaration.prop);
    });

    expect([...referencedVariables].filter((name) => !declaredVariables.has(name)).sort()).toEqual([]);
  });
});
