type MermaidApi = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidApi> | undefined;

/** Load Mermaid only when a diagram is rendered, keeping it out of the editor's startup chunk. */
export function getMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        fontFamily: 'var(--vscode-font-family, sans-serif)',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}
