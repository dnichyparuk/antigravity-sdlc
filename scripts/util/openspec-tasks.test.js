'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const { parseArgs, runOpenspecTasks } = require('./openspec-tasks');

test('parseArgs: --change flag', () => {
  assert.deepEqual(parseArgs(['node', 'openspec-tasks.js', '--change', 'add-widget']), { change: 'add-widget' });
});

test('parseArgs: --name alias (matches openspec_tasks_wrapper.sh:21-45)', () => {
  assert.deepEqual(parseArgs(['node', 'openspec-tasks.js', '--name', 'add-widget']), { change: 'add-widget' });
});

test('parseArgs: no flags -> change is null', () => {
  assert.deepEqual(parseArgs(['node', 'openspec-tasks.js']), { change: null });
});

test('runOpenspecTasks: success path — resolves path via path.join and parses tasks.md content', () => {
  let existsCalledWith = null;
  let readCalledWith = null;
  const existsSyncFn = (p) => { existsCalledWith = p; return true; };
  const readFileSyncFn = (p, enc) => { readCalledWith = { p, enc }; return '- [ ] do the thing\n- [x] done thing\n'; };
  const parseTasksFn = (content) => {
    assert.equal(content, '- [ ] do the thing\n- [x] done thing\n');
    return [{ ref: 'do-the-thing-abc123', line: 1, title: 'do the thing', indent: 0, done: false }];
  };

  const { json, exitCode } = runOpenspecTasks('/repo', 'add-widget', { existsSyncFn, readFileSyncFn, parseTasksFn });

  assert.equal(existsCalledWith, path.join('/repo', 'openspec', 'changes', 'add-widget', 'tasks.md'));
  assert.equal(readCalledWith.p, path.join('/repo', 'openspec', 'changes', 'add-widget', 'tasks.md'));
  assert.equal(readCalledWith.enc, 'utf8');
  assert.equal(exitCode, 0);
  assert.equal(json.status, 'success');
  assert.equal(json.tasks.length, 1);
  assert.equal(json.tasks[0].done, false);
});

test('runOpenspecTasks: error path — missing --change/--name', () => {
  const { json, exitCode } = runOpenspecTasks('/repo', null);

  assert.equal(exitCode, 1);
  assert.equal(json.status, 'error');
  assert.match(json.error, /--change \(or --name\) is required/);
});

test('runOpenspecTasks: error path — tasks.md does not exist', () => {
  const existsSyncFn = () => false;
  const readFileSyncFn = () => {
    throw new Error('should not be called when file does not exist');
  };

  const { json, exitCode } = runOpenspecTasks('/repo', 'missing-change', { existsSyncFn, readFileSyncFn });

  assert.equal(exitCode, 1);
  assert.equal(json.status, 'error');
  assert.match(json.error, /file does not exist/);
  assert.match(json.error, /missing-change/);
});
