import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const port = Number.parseInt(process.env.SDOC_UI_TEST_PORT ?? '4307', 10);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
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
