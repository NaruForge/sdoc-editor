# Structured Doc Editor

A VS Code extension that provides a WYSIWYG editor for `.sdoc` files with automatic AsciiDoc conversion.

## Features

- **WYSIWYG Editing**: Edit structured documents using a rich text editor powered by Tiptap
- **JSON Storage**: Documents are stored as pretty-printed JSON for optimal Git diff performance
- **Automatic Conversion**: Automatically generates `.adoc` (AsciiDoc) files on save
- **VS Code Integration**: Full undo/redo support integrated with VS Code's history
- **Theme Support**: Automatically adapts to VS Code's light/dark theme

## Supported Formatting

- **Text formatting**: Bold, Italic, Underline
- **Headings**: H1, H2, H3
- **Lists**: Bullet lists, Ordered lists
- **Code blocks**: Syntax-highlighted code blocks
- **Tables**: Insert and edit tables

## Installation

### From Source

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Press F5 to run the Extension Development Host

## Usage

1. Create a new file with the `.sdoc` extension
2. The custom editor will automatically open
3. Use the toolbar to format your document
4. Press Ctrl+S (Cmd+S on Mac) to save
5. An `.adoc` file will be automatically generated in the same directory

## Development

### Project Structure

- `src/` - Extension source code (Node.js)
  - `extension.ts` - Extension entry point
  - `SdocEditorProvider.ts` - Custom editor implementation
  - `converter/` - JSON to AsciiDoc converter
- `webview-ui/` - React-based webview UI
  - `src/components/` - React components
  - `src/hooks/` - Custom React hooks
  - `src/extensions/` - Tiptap extensions configuration

### Build Commands

- `npm run build` - Build both extension and webview
- `npm run build:ext` - Build extension only
- `npm run build:webview` - Build webview only
- `npm run watch` - Watch mode for both extension and webview

### Tech Stack

- **Extension**: TypeScript, VS Code Extension API
- **Webview**: React 18, TypeScript, Vite
- **Editor**: Tiptap (ProseMirror-based)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Conversion**: Custom JSON to AsciiDoc converter

## License

MIT
