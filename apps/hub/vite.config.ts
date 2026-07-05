import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const hubApiTarget = process.env.MINI_HUB_PROXY_API_URL ?? 'http://127.0.0.1:8787';
const aiOsTarget = process.env.MINI_HUB_PROXY_AI_OS_URL ?? 'http://127.0.0.1:8791';
const macroLabTarget = process.env.MINI_HUB_PROXY_MACRO_LAB_URL ?? 'http://127.0.0.1:8792';
const ollamaTarget = process.env.MINI_HUB_PROXY_OLLAMA_URL ?? 'http://127.0.0.1:11434';

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', '@huggingface/transformers', '@dimforge/rapier2d-compat']
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api/ai': {
        target: aiOsTarget,
        changeOrigin: true
      },
      '/api/macro-lab': {
        target: macroLabTarget,
        changeOrigin: true
      },
      '^/api/(blobs|chat|copy|create|delete|embed|embeddings|generate|ps|pull|push|show|tags|version)(/.*)?$': {
        target: ollamaTarget,
        changeOrigin: true
      },
      '/api': {
        target: hubApiTarget,
        changeOrigin: true
      }
    }
  },
  test: {
    include: ['src/**/*.test.ts']
  }
});
