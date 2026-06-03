#!/usr/bin/env node

const { spawnSync } = require('child_process');

const checks = [
  ['JavaScript syntax', 'scripts/check-js-syntax.js'],
  ['PWA cache', 'scripts/check-pwa-cache.js'],
  ['LogMiner', 'scripts/check-logminer.js'],
];

for (const [label, script] of checks) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

console.log('\nAll checks passed.');
