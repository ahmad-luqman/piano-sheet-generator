import { defineConfig } from 'vite';

// base is './' so the built site works from any static path (GitHub Pages subfolder etc).
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
} as any);
