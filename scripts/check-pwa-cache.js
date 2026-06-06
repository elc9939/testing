#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appManifest = fs.readFileSync(path.join(root, 'js', 'app-manifest.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function normalizeAsset(asset) {
  const trimmed = (asset || '').trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(trimmed)) {
    return null;
  }
  if (trimmed.startsWith('/')) return `.${trimmed}`;
  return trimmed.startsWith('./') ? trimmed : `./${trimmed}`;
}

function assetPath(asset) {
  const withoutQuery = asset.split(/[?#]/, 1)[0];
  if (withoutQuery === './') return '.';
  return withoutQuery.startsWith('./') ? withoutQuery.slice(2) : withoutQuery;
}

function splitAssetRef(asset) {
  const suffixIndex = asset.search(/[?#]/);
  if (suffixIndex < 0) return [asset, ''];
  return [asset.slice(0, suffixIndex), asset.slice(suffixIndex)];
}

function normalizeSourceRelativeAsset(asset, sourceFile) {
  const trimmed = (asset || '').trim();
  const normalized = normalizeAsset(trimmed);
  if (!normalized || trimmed.startsWith('/')) return normalized;

  const [assetPart, suffix] = splitAssetRef(trimmed);
  const sourceDir = path.posix.dirname(assetPath(sourceFile).replace(/\\/g, '/'));
  return normalizeAsset(`${path.posix.normalize(path.posix.join(sourceDir, assetPart))}${suffix}`);
}

function collectIndexAssets() {
  const assets = new Set(['./', './index.html']);
  const attrPattern = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
  let match;

  while ((match = attrPattern.exec(indexHtml)) !== null) {
    const asset = normalizeAsset(match[1] || match[2] || match[3]);
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

function collectAppManifestAssets() {
  const srcPattern = /\bsrc\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
  const assets = new Set();
  let match;

  while ((match = srcPattern.exec(appManifest)) !== null) {
    const asset = normalizeAsset(match[1] || match[2]);
    if (asset) assets.add(asset);
  }

  return [...assets].sort();
}

function collectLiteralAssets(files, pattern, resolveAsset) {
  const assets = new Set();

  for (const file of files) {
    const fullPath = path.join(root, assetPath(file));
    if (!fs.existsSync(fullPath)) continue;

    const source = fs.readFileSync(fullPath, 'utf8');
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(source)) !== null) {
      const asset = resolveAsset(match[1] || match[2], file);
      if (asset) assets.add(asset);
    }
  }

  return [...assets].sort();
}

function collectFetchAssets(files, options = {}) {
  const fetchPattern = /\bfetch\(\s*(?:"([^"]*)"|'([^']*)')/g;
  const resolveAsset = options.sourceRelative
    ? normalizeSourceRelativeAsset
    : asset => normalizeAsset(asset);
  return collectLiteralAssets(files, fetchPattern, resolveAsset);
}

function collectWorkerAssets(files) {
  const workerPattern = /\bnew\s+Worker\(\s*(?:"([^"]*)"|'([^']*)')/g;
  return collectLiteralAssets(files, workerPattern, asset => normalizeAsset(asset));
}

function collectImportScriptAssets(files) {
  const importScriptsPattern = /\bimportScripts\(\s*(?:"([^"]*)"|'([^']*)')/g;
  return collectLiteralAssets(files, importScriptsPattern, normalizeSourceRelativeAsset);
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

const appManifestAssets = collectAppManifestAssets();
const workerAssets = collectWorkerAssets(appManifestAssets);
const requiredAssets = [...new Set([
  ...collectIndexAssets(),
  ...collectManifestAssets(),
  ...appManifestAssets,
  ...collectFetchAssets(appManifestAssets),
  ...workerAssets,
  ...collectFetchAssets(workerAssets, { sourceRelative: true }),
  ...collectImportScriptAssets(workerAssets),
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
