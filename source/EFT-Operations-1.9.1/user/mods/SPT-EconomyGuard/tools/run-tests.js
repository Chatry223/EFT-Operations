'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const testsDir = path.join(root, 'tests');
const files = fs.readdirSync(testsDir).filter(name => name.endsWith('.test.js')).sort().map(name => path.join(testsDir, name));
files.push(path.join(root, 'src', 'operations', 'service.test.js'));
files.push(path.join(root, 'src', 'operations', 'fika243-adapter.test.js'));
files.push(path.join(root, 'src', 'operations', 'reward-delivery.test.js'));
let passed = 0, failed = 0;
const TEST_TIMEOUT_MS = 45000;
for (const file of files) {
  const relative = path.relative(root, file);
  const result = spawnSync(process.execPath, [file], {
    cwd: root,
    encoding: 'utf8',
    timeout: TEST_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status === 0 && !result.error) {
    passed++;
    process.stdout.write(`PASS ${relative}\n`);
  } else {
    failed++;
    const timedOut = result.error && result.error.code === 'ETIMEDOUT';
    process.stderr.write(`FAIL ${relative}${timedOut ? ` (TIMEOUT after ${TEST_TIMEOUT_MS} ms)` : ''}\n`);
    if (result.error) process.stderr.write(`Runner error: ${result.error.message}\n`);
    process.stderr.write(`${result.stdout || ''}${result.stderr || ''}`);
  }
}
process.stdout.write(`\nTest summary: ${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
