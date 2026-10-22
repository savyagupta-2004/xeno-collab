import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  // Components are .js files containing JSX (Next.js convention).
  esbuild: { loader: 'jsx', include: /\.jsx?$/, exclude: [], jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
