import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const port = Number.parseInt(process.env.SDOC_UI_TEST_PORT ?? '4307', 10);

// AJV's generated validator is ESM except for two standalone runtime helpers.
// The production esbuild pipeline resolves those helpers; this equivalent test-only
// transform lets Vite execute the exact generated validator in a real browser.
const generatedValidatorBrowserRuntime = (): Plugin => ({
  name: 'generated-validator-browser-runtime',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/shared/document/generated/documentValidators.js')) {
      return undefined;
    }
    return code
      .replace(
        '"use strict";',
        'import { fullFormats } from "ajv-formats/dist/formats.js";import ucs2Length from "ajv/dist/runtime/ucs2length.js";',
      )
      .replace(
        'require("ajv-formats/dist/formats").fullFormats["date-time"]',
        'fullFormats["date-time"]',
      )
      .replace(
        'require("ajv/dist/runtime/ucs2length").default',
        'ucs2Length',
      );
  },
});

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [generatedValidatorBrowserRuntime(), react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../shared', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});
