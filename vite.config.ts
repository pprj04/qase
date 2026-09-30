import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: '/app-react/',
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'public/app-react',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: fileURLToPath(new URL('./index-react.html', import.meta.url)),
    },
  },
  // theme-bootstrap.js is a plain static file copied verbatim (never bundled):
  // it must load synchronously before the React bundle to avoid a theme flash,
  // and as an external file it satisfies the app CSP (script-src 'self').
  publicDir: false,
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
