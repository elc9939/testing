#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const logminerDir = path.join(root, 'logminer');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function cleanClassFiles() {
  for (const name of fs.readdirSync(logminerDir)) {
    if (name.endsWith('.class')) {
      fs.rmSync(path.join(logminerDir, name), { force: true });
    }
  }
}

function compile() {
  const javaFiles = fs.readdirSync(logminerDir)
    .filter(name => name.endsWith('.java'))
    .sort()
    .map(name => path.join('logminer', name));

  run('javac', javaFiles);
}

function smokeTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logminer-smoke-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  fs.mkdirSync(inputDir);
  fs.mkdirSync(outputDir);

  const csv = [
    'timestamp,userId,action,bytes,status',
    '2026-06-03T01:00:00Z,alice,login,120,200',
    '2026-06-03T01:01:00Z,bob,download,400,200',
    'bad,line',
    '2026-06-03T01:02:00Z,alice,logout,80,204',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(inputDir, 'events.csv'), `\uFEFF${csv}`, 'utf8');
  run('java', ['logminer.Main', '--input', inputDir, '--output', outputDir, '--threads', '2', '--topUsers', '2']);

  const summary = JSON.parse(fs.readFileSync(path.join(outputDir, 'summary.json'), 'utf8'));
  assertEqual(summary.totals.validEvents, 3, 'validEvents');
  assertEqual(summary.totals.invalidLines, 1, 'invalidLines');
  assertEqual(summary.totals.totalBytes, 600, 'totalBytes');

  const errors = fs.readFileSync(path.join(outputDir, 'errors.csv'), 'utf8');
  const expectedError = '"events.csv","4","expected 5 fields, got 2","bad,line"';
  if (!errors.includes(expectedError)) {
    throw new Error(`errors.csv missing expected row: ${expectedError}`);
  }
}

try {
  compile();
  smokeTest();
  console.log('LogMiner compile and smoke test OK.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  cleanClassFiles();
}
