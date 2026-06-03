#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function normalizeAsset(asset) {
  if (!asset || asset.startsWith('http:') || asset.startsWith('https:') || asset.startsWith('//')) {
    return null;
  }
  return asset.startsWith('./') ? asset : `./${asset}`;
}

function assetPath(asset) {
  const withoutQuery = asset.split(/[?#]/, 1)[0];
  if (withoutQuery === './') return '.';
  return withoutQuery.startsWith('./') ? withoutQuery.slice(2) : withoutQuery;
}

function collectIndexAssets() {
  const assets = new Set(['./', './index.html']);
  const attrPattern = /(?:src|href)="([^"]+)"/g;
  let match;

  while ((match = attrPattern.exec(indexHtml)) !== null) {
    const asset = normalizeAsset(match[1]);
    if (asset) assets.add(asset);
  }

  return [...assets].sort();
}

function collectManifestAssets() {
  const assets = new Set();

  if (manifest.start_url) {
    const startUrl = normalizeAsset(manifest.start_url);
    if (startUrl) assets.add(startUrl);
  }

  for (const icon of manifest.icons || []) {
    const asset = normalizeAsset(icon.src);
    if (asset) assets.add(asset);
  }

  return [...assets].sort();
}

function collectCachedAssets() {
  const assetBlock = serviceWorker.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!assetBlock) {
    throw new Error('Could not find ASSETS array in sw.js');
  }

  const assets = [...assetBlock[1].matchAll(/['"]([^'"]+)['"]/g)]
    .map(match => normalizeAsset(match[1]))
    .filter(Boolean);

  return [...new Set(assets)].sort();
}

const requiredAssets = [...new Set([
  ...collectIndexAssets(),
  ...collectManifestAssets(),
])].sort();
const cachedAssets = collectCachedAssets();
const cached = new Set(cachedAssets);
const missing = requiredAssets.filter(asset => !cached.has(asset));
const nonexistent = cachedAssets.filter(asset => !fs.existsSync(path.join(root, assetPath(asset))));

if (missing.length) {
  console.error('sw.js is missing required PWA assets:');
  for (const asset of missing) console.error(`  - ${asset}`);
  process.exit(1);
}

if (nonexistent.length) {
  console.error('sw.js caches assets that do not exist:');
  for (const asset of nonexistent) console.error(`  - ${asset}`);
  process.exit(1);
}

console.log(`PWA cache covers ${requiredAssets.length} required assets and all cached paths exist.`);
