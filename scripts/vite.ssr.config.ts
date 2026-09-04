import { defineConfig } from 'vite';

// Server-side build for the catalog fingerprint script: bundles the TypeScript pipeline into one
// Node file. @tonejs/midi is CommonJS, so it must be bundled rather than left as a named ESM import.
export default defineConfig({
  build: { ssr: true, outDir: '.cache/ssr', emptyOutDir: true, sourcemap: false, rollupOptions: {} },
  ssr: { noExternal: ['@tonejs/midi'] },
} as any);
