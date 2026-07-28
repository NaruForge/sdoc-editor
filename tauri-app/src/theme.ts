export type SdocColorTheme = 'light' | 'dark';

type ThemeRoot = {
  dataset: DOMStringMap;
};

type ThemeMediaQuery = {
  matches: boolean;
  addEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void;
  removeEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void;
};

type TauriThemeWindow = {
  theme(): Promise<SdocColorTheme | null>;
  onThemeChanged(
    listener: (event: { payload: SdocColorTheme }) => void,
  ): Promise<() => void>;
};

export interface ThemeRuntime {
  root: ThemeRoot;
  mediaQuery: ThemeMediaQuery;
  loadTauriWindow: () => Promise<TauriThemeWindow>;
}

export type DisposeThemeRuntime = () => void;

export function preferredColorTheme(prefersDark: boolean): SdocColorTheme {
  return prefersDark ? 'dark' : 'light';
}

export function applyColorTheme(root: ThemeRoot, theme: SdocColorTheme): void {
  root.dataset.theme = theme;
}

function defaultThemeRuntime(): ThemeRuntime {
  return {
    root: document.documentElement,
    mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),
    loadTauriWindow: async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      return getCurrentWindow();
    },
  };
}

/**
 * Keeps the desktop shell in sync with the operating-system theme.
 *
 * The inline bootstrap in index.html supplies the first synchronous theme.
 * Tauri is authoritative once its window API is available; a browser media
 * query remains the fallback for preview, tests, and unavailable native APIs.
 */
export async function initializeSystemTheme(
  runtime: ThemeRuntime = defaultThemeRuntime(),
): Promise<DisposeThemeRuntime> {
  const applyPreference = (prefersDark: boolean) => {
    applyColorTheme(runtime.root, preferredColorTheme(prefersDark));
  };
  const handleMediaChange = (event: MediaQueryListEvent) => {
    applyPreference(event.matches);
  };

  applyPreference(runtime.mediaQuery.matches);

  try {
    const tauriWindow = await runtime.loadTauriWindow();
    const nativeTheme = await tauriWindow.theme();
    if (nativeTheme) {
      applyColorTheme(runtime.root, nativeTheme);
    }
    const unlisten = await tauriWindow.onThemeChanged(({ payload }) => {
      applyColorTheme(runtime.root, payload);
    });
    return unlisten;
  } catch (error: unknown) {
    console.warn('Native theme integration is unavailable; using system preference.', error);
    runtime.mediaQuery.addEventListener('change', handleMediaChange);
    return () => {
      runtime.mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }
}
