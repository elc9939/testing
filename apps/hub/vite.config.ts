import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import type { Plugin, ProxyOptions } from 'vite';

const hubApiTarget = process.env.MINI_HUB_PROXY_API_URL ?? 'http://127.0.0.1:8787';
const aiOsTarget = process.env.MINI_HUB_PROXY_AI_OS_URL ?? 'http://127.0.0.1:8791';
const macroLabTarget = process.env.MINI_HUB_PROXY_MACRO_LAB_URL ?? 'http://127.0.0.1:8792';
const ollamaTarget = process.env.MINI_HUB_PROXY_OLLAMA_URL ?? 'http://127.0.0.1:11434';
const gatewayToken =
  process.env.MINI_HUB_GATEWAY_TOKEN || process.env.MINI_HUB_BRIDGE_TOKEN || readGatewayTokenFile();
const extraAllowedHosts = (process.env.MINI_HUB_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const forwardedHeaders = [
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip'
];

function readGatewayTokenFile(): string {
  const path = process.env.MINI_HUB_GATEWAY_TOKEN_FILE ?? resolve(process.cwd(), '../../.mini-hub-bridge/remote-tunnel-token.txt');
  try {
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

function serviceProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq) => {
        for (const header of forwardedHeaders) proxyReq.removeHeader(header);
      });
    }
  };
}

function gatewayAuthPlugin(): Plugin {
  return {
    name: 'mini-hub-gateway-auth',
    configureServer(server) {
      if (!gatewayToken) return;
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          next();
          return;
        }
        const header = req.headers['x-mini-hub-bridge-token'];
        const token = Array.isArray(header) ? header[0] : header;
        if (token === gatewayToken) {
          next();
          return;
        }
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Mini Hub gateway token required.',
            detail: 'Open the bridge URL with its bridgeToken query parameter, or save the token in Settings.'
          })
        );
      });
    }
  };
}

export default defineConfig({
  plugins: [gatewayAuthPlugin(), sveltekit()],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', '@huggingface/transformers', '@dimforge/rapier2d-compat']
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: ['.trycloudflare.com', ...extraAllowedHosts],
    proxy: {
      '/api/ai': serviceProxy(aiOsTarget),
      '/api/macro-lab': serviceProxy(macroLabTarget),
      '^/api/(blobs|chat|copy|create|delete|embed|embeddings|generate|ps|pull|push|show|tags|version)(/.*)?$': serviceProxy(ollamaTarget),
      '/api': serviceProxy(hubApiTarget)
    }
  },
  test: {
    include: ['src/**/*.test.ts']
  }
});
