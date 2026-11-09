'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const testsDir = path.join(root, 'tests');
const files = fs.readdirSync(testsDir).filter(name => name.endsWith('.test.js')).sort().map(name => path.join(testsDir, name));
files.push(path.join(root, 'src', 'operations', 'service.test.js'));
files.push(path.join(root, 'src', 'operations', 'fika243-adapter.test.js'));
let passed = 0, failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) { passed++; process.stdout.write(`PASS ${path.relative(root, file)}\n`); }
  else { failed++; process.stderr.write(`FAIL ${path.relative(root, file)}\n${result.stdout || ''}${result.stderr || ''}`); }
}
process.stdout.write(`\nTest summary: ${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
