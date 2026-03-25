/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'vscode-background': 'var(--vscode-editor-background)',
        'vscode-foreground': 'var(--vscode-editor-foreground)',
        'vscode-button': 'var(--vscode-button-background)',
        'vscode-button-hover': 'var(--vscode-button-hoverBackground)',
        'vscode-focus': 'var(--vscode-focusBorder)',
        'vscode-input': 'var(--vscode-input-background)',
      },
    },
  },
  plugins: [],
}
