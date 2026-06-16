import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Get version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));

// Renderer build config. The renderer lives in src/ and is served by Vite in
// dev (port 5173) and built to dist/ for production. base is relative so the
// built index.html loads assets correctly when opened via file:// in Electron.
export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
