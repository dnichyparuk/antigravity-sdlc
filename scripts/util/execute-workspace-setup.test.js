'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { parseArgs } = require('./execute-workspace-setup');

const SCRIPT = path.join(__dirname, 'execute-workspace-setup.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'exec-ws-setup-'));
}

function makeTempRepo() {
  const dir = makeTempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function currentBranch(cwd) {
  return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim();
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

test('parseArgs reads all four execute-workspace flags', () => {
  const parsed = parseArgs([
    'node', 'execute-workspace-setup.js',
    '--workspace-flag', 'worktree',
    '--logical-type', 'bugfix',
    '--derived-slug', 'fix-the-thing',
    '--branch-name', 'custom/branch',
  ]);

  assert.deepStrictEqual(parsed, {
    workspaceFlag: 'worktree',
    logicalType:   'bugfix',
    derivedSlug:   'fix-the-thing',
    branchName:    'custom/branch',
    unknown:       null,
  });
});

test('parseArgs defaults every flag to an empty string', () => {
  const parsed = parseArgs(['node', 'execute-workspace-setup.js']);
  assert.strictEqual(parsed.workspaceFlag, '');
  assert.strictEqual(parsed.logicalType, '');
  assert.strictEqual(parsed.derivedSlug, '');
  assert.strictEqual(parsed.branchName, '');
  assert.strictEqual(parsed.unknown, null);
});

test('parseArgs does NOT accept the ship-only --prepare-output-file flag', () => {
  const parsed = parseArgs(['node', 'execute-workspace-setup.js', '--prepare-output-file', '/tmp/x']);
  assert.strictEqual(parsed.unknown, '--prepare-output-file');
});

test('parseArgs reports the first unknown parameter', () => {
  const parsed = parseArgs(['node', 'execute-workspace-setup.js', '--bogus', 'x']);
  assert.strictEqual(parsed.unknown, '--bogus');
});

// ---------------------------------------------------------------------------
// Success paths
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
    assert.strictEqual(res.json.executeBranch, 'feat/my-thing');
    assert.strictEqual(res.json.worktreePath, '');
    assert.strictEqual(currentBranch(repo), 'feat/my-thing');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--branch-name overrides the derived branch name', () => {
  const repo = makeTempRepo();
  try {
    const res = run(
      [
        '--workspace-flag', 'branch',
        '--logical-type', 'feature',
        '--derived-slug', 'ignored-slug',
        '--branch-name', 'custom/explicit-branch',
      ],
      repo
    );

    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.json.executeBranch, 'custom/explicit-branch');
    assert.strictEqual(currentBranch(repo), 'custom/explicit-branch');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('branch mode checks out an already-existing branch instead of failing', () => {
  const repo = makeTempRepo();
  try {
    execFileSync('git', ['branch', 'custom/pre-existing'], { cwd: repo, stdio: 'ignore' });

    const res = run(['--workspace-flag', 'branch', '--branch-name', 'custom/pre-existing'], repo);

    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.json.executeBranch, 'custom/pre-existing');
    assert.strictEqual(currentBranch(repo), 'custom/pre-existing');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('an unset workspace mode reports the branch without touching git', () => {
  const repo = makeTempRepo();
  const before = currentBranch(repo);
  try {
    const res = run(['--branch-name', 'custom/not-created'], repo);

    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.json.status, 'success');
    assert.strictEqual(res.json.executeBranch, 'custom/not-created');
    assert.strictEqual(res.json.worktreePath, '');
    assert.strictEqual(currentBranch(repo), before);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the JSON payload carries no ship-only workspaceMode key', () => {
  const repo = makeTempRepo();
  try {
    const res = run(['--workspace-flag', 'branch', '--derived-slug', 'shape-check'], repo);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(
      Object.keys(res.json).sort(),
      ['executeBranch', 'status', 'worktreePath']
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

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
