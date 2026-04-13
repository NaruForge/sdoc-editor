#!/usr/bin/env node
/**
 * .sdoc/.tiptap.json MCP Server — stdio transport
 *
 * Provides AI agents with tools to validate, create, export, import,
 * and process .sdoc/.tiptap.json structured documents.
 *
 * Run: node dist/mcp-server.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

import {
  validateSdoc,
  createSdoc,
  exportSdoc,
  importMarkdown,
  processAssignIds,
  processSyncRefs,
  processMigrate,
  queryDocument,
} from '../../shared/mcp/toolHandlers';

const server = new McpServer({
  name: 'sdoc',
  version: '1.0.0',
});

// ── Tool: sdoc.validate ───────────────────────────────────────────
server.tool(
  'sdoc_validate',
  'Validate a .sdoc/.tiptap.json file against the schema. Returns a list of errors if invalid. Input can be a file path or raw JSON content.',
  {
    input: z.string().describe('File path to a .sdoc/.tiptap.json file, or raw JSON string content'),
  },
  async ({ input }) => {
    let content = input;
    // If it looks like a file path, read it
    if (!input.trimStart().startsWith('{')) {
      try {
        content = fs.readFileSync(path.resolve(input), 'utf-8');
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error reading file: ${(e as Error).message}` }] };
      }
    }

    const result = validateSdoc(content);
    if (result.valid) {
      return { content: [{ type: 'text' as const, text: 'Valid .sdoc/.tiptap.json document.' }] };
    }
    const errorList = result.errors.map(e => `  • ${e.path}: ${e.message}`).join('\n');
    return { content: [{ type: 'text' as const, text: `Validation failed (${result.errors.length} error(s)):\n${errorList}` }] };
  }
);

// ── Tool: sdoc.create ─────────────────────────────────────────────
server.tool(
  'sdoc_create',
  'Create a new .sdoc/.tiptap.json document with the proper envelope structure. Returns the complete JSON. IMPORTANT: heading text must NOT include numbers (e.g. "1.", "1.1") — the editor auto-generates numbering via CSS counters. Always write bare titles only.',
  {
    title: z.string().optional().describe('Document title'),
    author: z.string().optional().describe('Author name'),
    version: z.string().optional().describe('Document version (default: "0.1")'),
  },
  async ({ title, author, version }) => {
    const json = createSdoc({ title, author, version });
    return { content: [{ type: 'text' as const, text: json }] };
  }
);

// ── Tool: sdoc.export ─────────────────────────────────────────────
server.tool(
  'sdoc_export',
  'Export a .sdoc/.tiptap.json document to HTML, Markdown, or AsciiDoc format. Input can be a file path or raw JSON content.',
  {
    input: z.string().describe('File path to a .sdoc/.tiptap.json file, or raw JSON string content'),
    format: z.enum(['html', 'markdown', 'asciidoc']).describe('Export format'),
    imageCaptionPrefix: z.string().optional().describe('Prefix for image captions (default: "Image")'),
    tableCaptionPrefix: z.string().optional().describe('Prefix for table captions (default: "Table")'),
    captionNumbering: z.enum(['sequential', 'hierarchical']).optional().describe('Caption numbering style'),
  },
  async ({ input, format, imageCaptionPrefix, tableCaptionPrefix, captionNumbering }) => {
    let content = input;
    if (!input.trimStart().startsWith('{')) {
      try {
        content = fs.readFileSync(path.resolve(input), 'utf-8');
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error reading file: ${(e as Error).message}` }] };
      }
    }

    try {
      const result = exportSdoc(content, { format, imageCaptionPrefix, tableCaptionPrefix, captionNumbering });
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Export error: ${(e as Error).message}` }] };
    }
  }
);

// ── Tool: sdoc.import ─────────────────────────────────────────────
server.tool(
  'sdoc_import',
  'Import Markdown text and convert it to .sdoc/.tiptap.json format. Returns the complete JSON.',
  {
    markdown: z.string().describe('Markdown text to convert'),
    title: z.string().optional().describe('Document title (auto-detected from H1 if omitted)'),
    author: z.string().optional().describe('Author name'),
  },
  async ({ markdown, title, author }) => {
    try {
      const result = importMarkdown(markdown, { title, author });
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Import error: ${(e as Error).message}` }] };
    }
  }
);

// ── Tool: sdoc.getSchema ──────────────────────────────────────────
server.tool(
  'sdoc_getSchema',
  'Get the .sdoc/.tiptap.json JSON schema definition. Use this to understand the document structure and valid node types.',
  {},
  async () => {
    // Try to find the schema file relative to the server script
    const candidates = [
      path.resolve(__dirname, '..', 'sdoc.schema.json'),
      path.resolve(__dirname, '..', '..', 'sdoc.schema.json'),
      path.resolve(process.cwd(), 'sdoc.schema.json'),
    ];

    for (const candidate of candidates) {
      try {
        const schema = fs.readFileSync(candidate, 'utf-8');
        return { content: [{ type: 'text' as const, text: schema }] };
      } catch {
        // try next
      }
    }

    return { content: [{ type: 'text' as const, text: 'Schema file not found. The schema is embedded in the sdoc-format instructions.' }] };
  }
);

// ── Tool: sdoc.assignIds ──────────────────────────────────────────
server.tool(
  'sdoc_assignIds',
  'Assign auto-generated IDs to headings, images, and tables in a .sdoc/.tiptap.json document. Headings get slugified text IDs, images get "figure-N", tables get "table-N". Existing IDs are preserved.',
  {
    input: z.string().describe('File path to a .sdoc/.tiptap.json file, or raw JSON string content'),
  },
  async ({ input }) => {
    let content = input;
    if (!input.trimStart().startsWith('{')) {
      try {
        content = fs.readFileSync(path.resolve(input), 'utf-8');
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error reading file: ${(e as Error).message}` }] };
      }
    }

    try {
      const result = processAssignIds(content);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] };
    }
  }
);

// ── Tool: sdoc.syncRefs ───────────────────────────────────────────
server.tool(
  'sdoc_syncRefs',
  'Synchronize cross-reference link texts with current heading/figure/table numbering in a .sdoc/.tiptap.json document.',
  {
    input: z.string().describe('File path to a .sdoc/.tiptap.json file, or raw JSON string content'),
  },
  async ({ input }) => {
    let content = input;
    if (!input.trimStart().startsWith('{')) {
      try {
        content = fs.readFileSync(path.resolve(input), 'utf-8');
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error reading file: ${(e as Error).message}` }] };
      }
    }

    try {
      const result = processSyncRefs(content);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] };
    }
  }
);

// ── Tool: sdoc.migrate ────────────────────────────────────────────
server.tool(
  'sdoc_migrate',
  'Migrate legacy .sdoc/.tiptap.json files: convert "data-*" attribute names to clean camelCase, wrap bare doc nodes in the proper envelope.',
  {
    input: z.string().describe('File path to a .sdoc/.tiptap.json file, or raw JSON string content'),
  },
  async ({ input }) => {
    let content = input;
    if (!input.trimStart().startsWith('{')) {
      try {
        content = fs.readFileSync(path.resolve(input), 'utf-8');
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error reading file: ${(e as Error).message}` }] };
      }
    }

    try {
      const result = processMigrate(content);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] };
    }
  }
);

// ── Tool: sdoc.query ──────────────────────────────────────────────
server.tool(
  'sdoc_query',
  'Analyze document structure: list all headings (with numbering), figures, tables, and cross-references. Useful for understanding document layout before editing.',
  {
    input: z.string().describe('File path to a .sdoc/.tiptap.json file, or raw JSON string content'),
  },
  async ({ input }) => {
    let content = input;
    if (!input.trimStart().startsWith('{')) {
      try {
        content = fs.readFileSync(path.resolve(input), 'utf-8');
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error reading file: ${(e as Error).message}` }] };
      }
    }

    try {
      const result = queryDocument(content);

      const lines: string[] = [];
      lines.push('# Document Structure\n');

      lines.push('## Headings');
      if (result.headings.length === 0) {
        lines.push('  (none)');
      } else {
        for (const h of result.headings) {
          const indent = '  '.repeat(h.level - 1);
          lines.push(`  ${indent}${h.numbering} ${h.text} [id: ${h.id || '(none)'}]`);
        }
      }

      lines.push('\n## Figures');
      if (result.figures.length === 0) {
        lines.push('  (none)');
      } else {
        for (const f of result.figures) {
          lines.push(`  Figure ${f.number}: ${f.caption || '(no caption)'} [id: ${f.id || '(none)'}]`);
        }
      }

      lines.push('\n## Tables');
      if (result.tables.length === 0) {
        lines.push('  (none)');
      } else {
        for (const t of result.tables) {
          lines.push(`  Table ${t.number}: ${t.caption || '(no caption)'} [id: ${t.id || '(none)'}]`);
        }
      }

      lines.push('\n## Cross-References');
      if (result.crossReferences.length === 0) {
        lines.push('  (none)');
      } else {
        for (const r of result.crossReferences) {
          const status = r.targetExists ? '✓' : '✗ BROKEN';
          lines.push(`  ${r.href} → "${r.text}" [${status}]`);
        }
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] };
    }
  }
);

// ── Resources ─────────────────────────────────────────────────────
server.resource(
  'sdoc-schema',
  'sdoc://schema',
  { description: 'The .sdoc/.tiptap.json JSON schema definition', mimeType: 'application/json' },
  async () => {
    const candidates = [
      path.resolve(__dirname, '..', 'sdoc.schema.json'),
      path.resolve(__dirname, '..', '..', 'sdoc.schema.json'),
      path.resolve(process.cwd(), 'sdoc.schema.json'),
    ];

    for (const candidate of candidates) {
      try {
        const schema = fs.readFileSync(candidate, 'utf-8');
        return { contents: [{ uri: 'sdoc://schema', text: schema, mimeType: 'application/json' }] };
      } catch {
        // try next
      }
    }

    return { contents: [{ uri: 'sdoc://schema', text: '{}', mimeType: 'application/json' }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server failed to start:', error);
  process.exit(1);
});
