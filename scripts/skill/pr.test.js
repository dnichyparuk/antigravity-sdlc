'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseArgs, detectIssueTicket, detectPrMode } = require('./pr.js');

test('parseArgs: defaults when no flags passed', () => {
  const result = parseArgs(['node', 'pr.js']);
  assert.strictEqual(result.isDraft, false);
  assert.strictEqual(result.forceUpdate, false);
  assert.strictEqual(result.baseBranchOverride, null);
  assert.strictEqual(result.isAuto, false);
  assert.deepStrictEqual(result.forcedLabels, []);
  assert.strictEqual(result.expectedBranch, null);
});

test('parseArgs: recognizes --draft, --update, --auto', () => {
  const result = parseArgs(['node', 'pr.js', '--draft', '--update', '--auto']);
  assert.strictEqual(result.isDraft, true);
  assert.strictEqual(result.forceUpdate, true);
  assert.strictEqual(result.isAuto, true);
});

test('parseArgs: --base takes the following value', () => {
  const result = parseArgs(['node', 'pr.js', '--base', 'develop']);
  assert.strictEqual(result.baseBranchOverride, 'develop');
});

test('parseArgs: --label can repeat and dedupes', () => {
  const result = parseArgs(['node', 'pr.js', '--label', 'bug', '--label', 'urgent', '--label', 'bug']);
  assert.deepStrictEqual(result.forcedLabels, ['bug', 'urgent']);
});

test('parseArgs: --expected-branch takes the following value', () => {
  const result = parseArgs(['node', 'pr.js', '--expected-branch', 'feat/x']);
  assert.strictEqual(result.expectedBranch, 'feat/x');
});

test('parseArgs: a flag missing its required value is ignored, not consumed as a positional', () => {
  const result = parseArgs(['node', 'pr.js', '--base']);
  assert.strictEqual(result.baseBranchOverride, null);
});

test('detectIssueTicket: finds a ticket key in the branch name', () => {
  const key = detectIssueTicket('feat/PROJ-123-add-thing', []);
  assert.strictEqual(key, 'PROJ-123');
});

test('detectIssueTicket: falls back to commit subjects when branch has no key', () => {
  const key = detectIssueTicket('feat/add-thing', [{ subject: 'PROJ-456: add thing' }]);
  assert.strictEqual(key, 'PROJ-456');
});

test('detectIssueTicket: returns null when no ticket key is found anywhere', () => {
  const key = detectIssueTicket('feat/add-thing', [{ subject: 'add thing' }]);
  assert.strictEqual(key, null);
});

test('detectPrMode: --update with an existing PR updates', () => {
  const result = detectPrMode(true, { exists: true, number: 3 });
  assert.deepStrictEqual(result, { mode: 'update' });
});

test('detectPrMode: --update with no existing PR errors', () => {
  const result = detectPrMode(true, { exists: false });
  assert.strictEqual(result.mode, 'create');
  assert.ok(result.error && result.error.includes('No existing PR found'));
});

test('detectPrMode: no flag, PR exists -> update', () => {
  const result = detectPrMode(false, { exists: true });
  assert.deepStrictEqual(result, { mode: 'update' });
});

test('detectPrMode: no flag, no PR -> create, no error', () => {
  const result = detectPrMode(false, { exists: false });
  assert.deepStrictEqual(result, { mode: 'create' });
});
