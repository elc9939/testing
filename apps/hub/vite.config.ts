import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', '@huggingface/transformers', '@dimforge/rapier2d-compat']
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  },
  test: {
    include: ['src/**/*.test.ts']
  }
});
