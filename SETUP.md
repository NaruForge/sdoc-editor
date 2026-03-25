# Setup and Testing Guide

## Prerequisites

- Node.js 18+ and npm
- VS Code 1.85.0 or higher

## Installation Steps

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Build the extension**
   ```bash
   npm run build
   ```

## Testing the Extension

### Method 1: Extension Development Host (Recommended)

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. In the new VS Code window:
   - Open the `sample` folder or create a new folder
   - Open `example.sdoc` or create a new `.sdoc` file
   - The custom editor should appear automatically

### Method 2: Manual Testing

1. Build the extension: `npm run build`
2. Install the extension:
   - Press `Ctrl+Shift+P` (Cmd+Shift+P on Mac)
   - Run "Extensions: Install from VSIX..."
   - Package first with: `npx vsce package`
   - Select the generated `.vsix` file

## Development Workflow

### Watch Mode

For active development, use watch mode to automatically rebuild on changes:

```bash
npm run watch
```

This runs both:
- `watch:ext` - Watches extension TypeScript files
- `watch:webview` - Watches webview React files

### Building Individual Parts

- Extension only: `npm run build:ext`
- Webview only: `npm run build:webview`

## Testing the Editor Features

1. **Create a new .sdoc file**
   - Create a file named `test.sdoc`
   - The editor should open automatically

2. **Test formatting options**
   - Click toolbar buttons: Bold, Italic, Underline
   - Try headings: H1, H2, H3
   - Create lists: Bullet and Ordered
   - Insert a table
   - Add a code block

3. **Test save and conversion**
   - Press `Ctrl+S` (Cmd+S on Mac)
   - Check that a `test.adoc` file is created in the same directory
   - Open the `.adoc` file to verify the AsciiDoc output

4. **Test undo/redo**
   - Make some edits
   - Press `Ctrl+Z` to undo
   - Press `Ctrl+Shift+Z` to redo
   - Verify that the `.sdoc` JSON updates correctly

5. **Test theme integration**
   - Switch VS Code theme (File > Preferences > Color Theme)
   - Verify the editor adapts to light/dark themes

## Verification Checklist

- [ ] Extension builds without errors
- [ ] Webview builds without errors
- [ ] `.sdoc` files open in custom editor
- [ ] Toolbar buttons work and show active state
- [ ] Ctrl+S saves the document
- [ ] `.adoc` file is generated on save
- [ ] Undo/Redo works correctly
- [ ] Editor adapts to VS Code theme changes
- [ ] External changes to `.sdoc` file update the editor

## Troubleshooting

### Extension doesn't activate
- Check the Output panel (View > Output) and select "Structured Doc Editor"
- Verify activationEvents in package.json
- Rebuild: `npm run build`

### Webview doesn't load
- Check browser console in webview (Help > Toggle Developer Tools)
- Verify dist/webview/ contains index.html, index.js, index.css
- Rebuild webview: `npm run build:webview`

### Changes not reflected
- If using watch mode, check that both watchers are running
- Try stopping and restarting the Extension Development Host
- Clear VS Code cache: Close all windows, delete workspace storage

### .adoc file not generated
- Check that the .sdoc file contains valid JSON
- Look for error messages in VS Code notifications
- Check the converter logic in `src/converter/jsonToAdoc.ts`

## Project Structure

```
.
├── .vscode/
│   ├── launch.json         # F5 debug configuration
│   └── tasks.json          # Build tasks
├── dist/                   # Compiled output (git-ignored)
│   ├── extension.js        # Extension bundle
│   └── webview/            # Webview bundle
├── src/                    # Extension source
│   ├── extension.ts        # Entry point
│   ├── SdocEditorProvider.ts
│   ├── converter/
│   │   └── jsonToAdoc.ts
│   └── utils/
│       └── webviewHelper.ts
├── webview-ui/             # React webview
│   ├── src/
│   │   ├── components/
│   │   ├── context/
│   │   ├── extensions/
│   │   ├── hooks/
│   │   └── styles/
│   ├── package.json
│   └── vite.config.ts
├── sample/
│   └── example.sdoc        # Sample document
└── package.json            # Extension manifest
```

## Next Steps

- Add more Tiptap extensions (e.g., images, links)
- Implement diff-based updates for large documents
- Add configuration options for AsciiDoc output
- Implement validation for JSON structure
- Add tests for converter and extension logic
