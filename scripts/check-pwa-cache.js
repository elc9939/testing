#!/usr/bin/env node

const fs = require('fs');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');

function normalizeAsset(path) {
  if (!path || path.startsWith('http:') || path.startsWith('https:') || path.startsWith('//')) {
    return null;
  }
  return path.startsWith('./') ? path : `./${path}`;
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

function collectCachedAssets() {
  const assetBlock = serviceWorker.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!assetBlock) {
    throw new Error('Could not find ASSETS array in sw.js');
  }

  return [...assetBlock[1].matchAll(/['"]([^'"]+)['"]/g)]
    .map(match => normalizeAsset(match[1]))
    .filter(Boolean)
    .sort();
}

const indexAssets = collectIndexAssets();
const cachedAssets = collectCachedAssets();
const cached = new Set(cachedAssets);
const missing = indexAssets.filter(asset => !cached.has(asset));

if (missing.length) {
  console.error('sw.js is missing assets referenced by index.html:');
  for (const asset of missing) console.error(`  - ${asset}`);
  process.exit(1);
}

console.log(`PWA cache covers ${indexAssets.length} index assets.`);
