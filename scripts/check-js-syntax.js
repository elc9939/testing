#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOTS = ['sw.js', 'js', 'scripts'];

function collectJsFiles(entry) {
  const fullPath = path.join(process.cwd(), entry);
  if (!fs.existsSync(fullPath)) return [];

  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return entry.endsWith('.js') ? [entry] : [];
  }
  if (!stat.isDirectory()) return [];

  const files = [];
  for (const name of fs.readdirSync(fullPath).sort()) {
    files.push(...collectJsFiles(path.join(entry, name)));
  }
  return files;
}

const files = [...new Set(ROOTS.flatMap(collectJsFiles))]
  .map(file => file.replace(/\\/g, '/'))
  .sort();

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`JavaScript syntax OK for ${files.length} files.`);
