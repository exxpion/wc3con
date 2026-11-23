import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'public',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
});
