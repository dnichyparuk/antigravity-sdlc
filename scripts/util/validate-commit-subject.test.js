'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'validate-commit-subject.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('validate-commit-subject: exits 0 when the subject matches the pattern (success path)', () => {
  const result = run(['^(feat|fix|chore)(\\(.+\\))?: .+', 'feat(commit): add link validator']);
  assert.equal(result.status, 0);
});

test('validate-commit-subject: exits 1 when the subject does not match the pattern (error path)', () => {
  const result = run(['^(feat|fix|chore)(\\(.+\\))?: .+', 'update stuff without a type prefix']);
  assert.equal(result.status, 1);
});

test('parseArgs: extracts the positional pattern and subject', () => {
  const { parseArgs } = require('./validate-commit-subject');
  const { pattern, subject } = parseArgs(['node', 'validate-commit-subject.js', '^feat', 'feat: x']);
  assert.equal(pattern, '^feat');
  assert.equal(subject, 'feat: x');
});
