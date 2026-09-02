'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { parseArgs } = require('./ship-workspace-setup');

const SCRIPT = path.join(__dirname, 'ship-workspace-setup.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ship-ws-setup-'));
}

function makeTempRepo() {
  const dir = makeTempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function run(args, cwd) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SDLC_STATE_DIR_OVERRIDE: path.join(cwd, '.sdlc-test-state') },
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch (_) { /* left null */ }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs reads all four workspace flags', () => {
  const parsed = parseArgs([
    'node', 'ship-workspace-setup.js',
    '--workspace-flag', 'worktree',
    '--prepare-output-file', '/tmp/prepare.json',
    '--logical-type', 'bugfix',
    '--derived-slug', 'fix-the-thing',
  ]);

  assert.deepStrictEqual(parsed, {
    workspaceFlag:     'worktree',
    prepareOutputFile: '/tmp/prepare.json',
    logicalType:       'bugfix',
    derivedSlug:       'fix-the-thing',
    unknown:           null,
  });
});

test('parseArgs defaults every flag to an empty string', () => {
  const parsed = parseArgs(['node', 'ship-workspace-setup.js']);
  assert.strictEqual(parsed.workspaceFlag, '');
  assert.strictEqual(parsed.prepareOutputFile, '');
  assert.strictEqual(parsed.logicalType, '');
  assert.strictEqual(parsed.derivedSlug, '');
  assert.strictEqual(parsed.unknown, null);
});

test('parseArgs reports the first unknown parameter', () => {
  const parsed = parseArgs(['node', 'ship-workspace-setup.js', '--bogus', 'x']);
  assert.strictEqual(parsed.unknown, '--bogus');
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

test('branch mode creates the resolved branch and reports success', () => {
  const repo = makeTempRepo();
  try {
    const res = run(
      ['--workspace-flag', 'branch', '--logical-type', 'feature', '--derived-slug', 'my-thing'],
      repo
    );

    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.json, `expected JSON on stdout, got: ${res.stdout}`);
    assert.strictEqual(res.json.status, 'success');
    assert.strictEqual(res.json.workspaceMode, 'branch');
    assert.strictEqual(res.json.executeBranch, 'feat/my-thing');
    assert.strictEqual(res.json.worktreePath, '');

    const current = execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim();
    assert.strictEqual(current, 'feat/my-thing');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

test('missing workspace mode exits 1 with an error payload', () => {
  const dir = makeTempDir();
  try {
    const res = run([], dir);

    assert.strictEqual(res.status, 1);
    assert.ok(res.json, `expected JSON on stdout, got: ${res.stdout}`);
    assert.strictEqual(res.json.status, 'error');
    assert.match(res.json.error, /Workspace mode not set/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cwd assertion failure exits 1 with the expected root in the message', () => {
  const repo = makeTempRepo();
  try {
    const manifest = path.join(repo, 'prepare.json');
    fs.writeFileSync(manifest, JSON.stringify({
      assertions: {
        requireMainWorktreeCwd: true,
        expectedMainWorktreeRoot: '/definitely/not/this/repo',
      },
    }));

    const res = run(
      ['--workspace-flag', 'branch', '--prepare-output-file', manifest, '--derived-slug', 'my-thing'],
      repo
    );

    assert.strictEqual(res.status, 1);
    assert.ok(res.json, `expected JSON on stdout, got: ${res.stdout}`);
    assert.strictEqual(res.json.status, 'error');
    assert.match(res.json.error, /cwd assertion failed/);
    assert.match(res.json.error, /\/definitely\/not\/this\/repo/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('unknown parameter exits 1 with a stderr diagnostic and no stdout JSON', () => {
  const dir = makeTempDir();
  try {
    const res = run(['--nope'], dir);

    assert.strictEqual(res.status, 1);
    assert.strictEqual(res.stdout, '');
    assert.match(res.stderr, /Unknown parameter passed: --nope/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
