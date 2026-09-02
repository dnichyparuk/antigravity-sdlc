'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { exec } = require('./git.js');

test('exec() does not silently truncate output larger than execSync\'s 1 MiB default maxBuffer', () => {
  // Reproduces the review-sdlc/pr-sdlc "0-byte diff" bug: a large `git diff`
  // output exceeded execSync's default 1 MiB maxBuffer, which threw
  // ERR_CHILD_PROCESS_STDOUT_MAXBUFFER — silently caught by exec() and
  // returned as null, misread downstream as "no diff content" for every file.
  const oneMiB = 1024 * 1024;
  const targetBytes = oneMiB + 100 * 1024; // safely over the 1 MiB default
  // Print `targetBytes` 'a' characters via Node itself — avoids depending on
  // a platform-specific shell builtin (yes/head) being present.
  const cmd = `node -e "process.stdout.write('a'.repeat(${targetBytes}))"`;

  const result = exec(cmd);

  assert.notStrictEqual(result, null, 'exec() must not return null for output over the old 1 MiB default');
  assert.ok(result.length >= targetBytes - 1, `expected >= ${targetBytes - 1} chars, got ${result.length}`);
});

test('exec() still returns null on a genuinely failing command', () => {
  const result = exec('node -e "process.exit(1)"');
  assert.strictEqual(result, null);
});

test('exec() rethrows on a genuinely failing command when throwOnError is set', () => {
  assert.throws(() => exec('node -e "process.exit(1)"', { throwOnError: true }));
});
