import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: '',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        book: resolve(__dirname, 'book.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => assetInfo.names.some((name) => name.endsWith('.css'))
          ? 'assets/webview.css'
          : 'assets/[name].[ext]',
      },
    },
  },
  server: {
    port: 5173,
  },
});
