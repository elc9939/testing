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

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
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
    '2026-06-03T01:01:30Z,"tab\\name, ""quoted""",upload,50,201',
    'bad,line',
    '2026-06-03T01:02:00Z,alice,logout,80,204',
    '',
  ].join('\n');

  fs.mkdirSync(path.join(inputDir, 'archive.csv'));
  fs.writeFileSync(path.join(inputDir, 'notes.txt'), 'not a CSV log\n', 'utf8');
  fs.writeFileSync(path.join(inputDir, 'events.csv'), `\uFEFF${csv}`, 'utf8');
  run('java', [
    '-Duser.language=tr',
    '-Duser.country=TR',
    'logminer.Main',
    '--input', inputDir,
    '--output', outputDir,
    '--threads', '2',
    '--topUsers', '2',
  ]);

  const summary = JSON.parse(fs.readFileSync(path.join(outputDir, 'summary.json'), 'utf8'));
  assertEqual(summary.totals.validEvents, 4, 'validEvents');
  assertEqual(summary.totals.invalidLines, 1, 'invalidLines');
  assertEqual(summary.totals.totalBytes, 650, 'totalBytes');
  assertEqual(summary.counts.byAction.UPLOAD, 1, 'UPLOAD count');

  const errors = fs.readFileSync(path.join(outputDir, 'errors.csv'), 'utf8');
  const expectedError = '"events.csv","5","expected 5 fields, got 2","bad,line"';
  if (!errors.includes(expectedError)) {
    throw new Error(`errors.csv missing expected row: ${expectedError}`);
  }

  const usersCsv = fs.readFileSync(path.join(outputDir, 'users.csv'), 'utf8').trim().split(/\r?\n/);
  assertDeepEqual(usersCsv, [
    'userId,events,totalBytes',
    '"alice",2,200',
    '"bob",1,400',
    '"tab\\name, ""quoted""",1,50',
  ], 'users.csv');

  assertDeepEqual(readSummaryBin(path.join(outputDir, 'summary.bin')), {
    magic: 'L3SB',
    version: 1,
    validEvents: 4,
    invalidLines: 1,
    totalBytes: 650,
    users: [
      { userId: 'alice', events: 2, bytes: 200 },
      { userId: 'bob', events: 1, bytes: 400 },
      { userId: 'tab\\name, "quoted"', events: 1, bytes: 50 },
    ],
  }, 'summary.bin');
}

function readSummaryBin(file) {
  const data = fs.readFileSync(file);
  let offset = 0;

  function read(length) {
    const end = offset + length;
    if (end > data.length) throw new Error('summary.bin ended unexpectedly');
    const slice = data.subarray(offset, end);
    offset = end;
    return slice;
  }

  const result = {
    magic: read(4).toString('ascii'),
    version: read(1).readUInt8(0),
    validEvents: read(4).readInt32BE(0),
    invalidLines: read(4).readInt32BE(0),
    totalBytes: Number(read(8).readBigInt64BE(0)),
    users: [],
  };

  const userCount = read(4).readInt32BE(0);
  for (let i = 0; i < userCount; i++) {
    const userIdLength = read(2).readUInt16BE(0);
    result.users.push({
      userId: read(userIdLength).toString('utf8'),
      events: read(4).readInt32BE(0),
      bytes: Number(read(8).readBigInt64BE(0)),
    });
  }

  if (offset !== data.length) {
    throw new Error(`summary.bin has ${data.length - offset} trailing bytes`);
  }
  return result;
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
