import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer build config. The renderer lives in src/ and is served by Vite in
// dev (port 5173) and built to dist/ for production. base is relative so the
// built index.html loads assets correctly when opened via file:// in Electron.
export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
