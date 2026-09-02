'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  parseArgs,
  detectWipSquash,
  runSquash,
  runStashTransaction,
} = require('./commit.js');

const SCRIPT = path.join(__dirname, 'commit.js');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * A repo on a feature branch with `main` as the fork base and N
 * `wip(execute):` commits stacked on top. No remote is configured, so
 * detectWipSquash() exercises its default-branch fallback path.
 */
function makeRepoWithWip(wipCount = 2) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commit-squash-')));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'chore: init']);
  const forkPoint = git(dir, ['rev-parse', 'HEAD']).trim();

  git(dir, ['checkout', '-q', '-b', 'feature/x']);
  for (let i = 1; i <= wipCount; i++) {
    fs.writeFileSync(path.join(dir, `wip${i}.txt`), `wip ${i}\n`);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', `wip(execute): wave ${i}`]);
  }
  return { dir, forkPoint };
}

function inDir(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}

function runCli(cwd, args) {
  const result = spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// parseArgs — execution-mode flags
// ---------------------------------------------------------------------------

test('parseArgs: execution-mode flags default to off', () => {
  const parsed = parseArgs(['node', 'commit.js']);
  assert.strictEqual(parsed.squashExecute, false);
  assert.strictEqual(parsed.stashTransaction, false);
  assert.strictEqual(parsed.forkPoint, null);
  assert.strictEqual(parsed.message, null);
});

test('parseArgs: --squash-execute and --fork-point <sha>', () => {
  const parsed = parseArgs(['node', 'commit.js', '--squash-execute', '--fork-point', 'abc1234']);
  assert.strictEqual(parsed.squashExecute, true);
  assert.strictEqual(parsed.forkPoint, 'abc1234');
});

test('parseArgs: --stash-transaction --message <msg> --amend', () => {
  const parsed = parseArgs(['node', 'commit.js', '--stash-transaction', '--message', 'feat: x', '--amend']);
  assert.strictEqual(parsed.stashTransaction, true);
  assert.strictEqual(parsed.message, 'feat: x');
  assert.strictEqual(parsed.amend, true);
});

test('parseArgs: existing flags still parse alongside the new ones', () => {
  const parsed = parseArgs(['node', 'commit.js', '--no-stash', '--scope', 'api', '--type', 'fix', '--no-squash-wip']);
  assert.strictEqual(parsed.noStash, true);
  assert.strictEqual(parsed.scope, 'api');
  assert.strictEqual(parsed.type, 'fix');
  assert.strictEqual(parsed.noSquashWip, true);
});

// ---------------------------------------------------------------------------
// detectWipSquash — forkPoint is surfaced
// ---------------------------------------------------------------------------

test('detectWipSquash surfaces the resolved forkPoint alongside commits', () => {
  const { dir, forkPoint } = makeRepoWithWip(2);
  try {
    const result = inDir(dir, () => detectWipSquash());
    assert.strictEqual(result.forkPoint, forkPoint);
    assert.strictEqual(result.commits.length, 2);
    assert.strictEqual(result.stagedClean, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectWipSquash forkPoint is the merge-base, not the current branch name', () => {
  const { dir, forkPoint } = makeRepoWithWip(1);
  try {
    const result = inDir(dir, () => detectWipSquash());
    // The old raw-prose fallback resolved to the current branch's own name,
    // which made `git merge-base HEAD <that-branch>` a no-op (it returned HEAD).
    const head = git(dir, ['rev-parse', 'HEAD']).trim();
    assert.notStrictEqual(result.forkPoint, head);
    assert.notStrictEqual(result.forkPoint, 'feature/x');
    assert.strictEqual(result.forkPoint, forkPoint);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectWipSquash reports forkPoint: null when no fork-point resolves', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commit-nofork-')));
  try {
    git(dir, ['init', '-q', '-b', 'orphan']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'chore: init']);
    const result = inDir(dir, () => detectWipSquash());
    assert.strictEqual(result.forkPoint, null);
    assert.deepStrictEqual(result.commits, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// runSquash — uses the detected forkPoint verbatim
// ---------------------------------------------------------------------------

test('runSquash resets to exactly the fork-point it was given, then re-stages', () => {
  const calls = [];
  const spawnFn = (cmd, args) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = runSquash('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', { spawnFn, cwd: '/tmp' });
  assert.deepStrictEqual(result, { status: 'squashed', forkPoint: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
  assert.deepStrictEqual(calls[0], ['reset', '--soft', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef']);
  assert.deepStrictEqual(calls[1], ['add', '-A']);
  assert.strictEqual(calls.length, 2);
  // No merge-base is ever re-derived inside the execution path.
  assert.ok(!calls.some(a => a.includes('merge-base')));
  assert.ok(!calls.some(a => a.includes('symbolic-ref')));
});

test('runSquash refuses a missing fork-point instead of guessing', () => {
  const calls = [];
  const spawnFn = (cmd, args) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  for (const bad of [null, '', '   ']) {
    const result = runSquash(bad, { spawnFn });
    assert.strictEqual(result.status, 'failed');
    assert.match(result.message, /No fork-point resolved/);
  }
  assert.strictEqual(calls.length, 0, 'no git command may run without a fork-point');
});

test('runSquash returns failed when git reset --soft fails and does not run git add', () => {
  const calls = [];
  const spawnFn = (cmd, args) => {
    calls.push(args);
    return { status: 128, stdout: '', stderr: "fatal: ambiguous argument 'abc123'" };
  };
  const result = runSquash('abc123', { spawnFn });
  assert.strictEqual(result.status, 'failed');
  assert.strictEqual(result.forkPoint, 'abc123');
  assert.match(result.message, /ambiguous argument/);
  assert.strictEqual(calls.length, 1);
});

test('runSquash returns failed when git add -A fails', () => {
  const spawnFn = (cmd, args) => (args[0] === 'reset'
    ? { status: 0, stdout: '', stderr: '' }
    : { status: 1, stdout: '', stderr: 'fatal: could not add' });
  const result = runSquash('abc123', { spawnFn });
  assert.strictEqual(result.status, 'failed');
  assert.match(result.message, /could not add/);
});

test('detectWipSquash forkPoint feeds runSquash: WIP commits vanish, changes stay staged', () => {
  const { dir, forkPoint } = makeRepoWithWip(3);
  try {
    const detected = inDir(dir, () => detectWipSquash());
    assert.strictEqual(detected.commits.length, 3);

    const result = runSquash(detected.forkPoint, { cwd: dir });
    assert.deepStrictEqual(result, { status: 'squashed', forkPoint });

    // History is back at the fork-point.
    assert.strictEqual(git(dir, ['rev-parse', 'HEAD']).trim(), forkPoint);
    // Every WIP file change is preserved, staged.
    const staged = git(dir, ['diff', '--cached', '--name-only']).trim().split('\n').sort();
    assert.deepStrictEqual(staged, ['wip1.txt', 'wip2.txt', 'wip3.txt']);
    // Re-running detection is now a no-op (state-machine idempotency).
    const after = inDir(dir, () => detectWipSquash());
    assert.deepStrictEqual(after.commits, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// runStashTransaction — the three pinned outcomes
// ---------------------------------------------------------------------------

function stubGit(handlers) {
  const calls = [];
  const spawnFn = (cmd, args) => {
    calls.push(args.join(' '));
    for (const [prefix, response] of handlers) {
      if (args.join(' ').startsWith(prefix)) return response;
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { spawnFn, calls };
}

test('runStashTransaction: happy path -> committed, no hook failure, no pop conflict', () => {
  const { spawnFn, calls } = stubGit([
    ['diff --name-only --diff-filter=U', { status: 0, stdout: '', stderr: '' }],
    ['diff --name-only', { status: 0, stdout: 'b.txt', stderr: '' }],
    ['stash push', { status: 0, stdout: 'Saved working directory and index state', stderr: '' }],
    ['stash pop', { status: 0, stdout: '', stderr: '' }],
  ]);
  const result = runStashTransaction(() => ({ status: 0, stdout: '', stderr: '' }), { spawnFn });
  assert.deepStrictEqual(result, { committed: true, hookFailed: false, popConflict: false });
  assert.ok(calls.some(c => c === 'stash push --keep-index -m commit-sdlc: temp stash'));
  assert.ok(calls.some(c => c === 'stash pop'));
});

test('runStashTransaction: hook failure -> not committed, stash deliberately left in place', () => {
  const { spawnFn, calls } = stubGit([
    ['diff --name-only', { status: 0, stdout: 'b.txt', stderr: '' }],
    ['stash push', { status: 0, stdout: 'Saved working directory and index state', stderr: '' }],
  ]);
  const result = runStashTransaction(
    () => ({ status: 1, stdout: '', stderr: 'eslint failed on 2 files' }),
    { spawnFn },
  );
  assert.strictEqual(result.committed, false);
  assert.strictEqual(result.hookFailed, true);
  assert.strictEqual(result.popConflict, false);
  assert.strictEqual(result.reason, 'pre-commit hook exited non-zero');
  assert.match(result.detail, /eslint failed/);
  assert.ok(!calls.some(c => c === 'stash pop'), 'stash must survive a hook failure');
});

test('runStashTransaction: stash pop conflict -> committed with conflictFiles from the unmerged index', () => {
  const spawnFn = (cmd, args) => {
    const key = args.join(' ');
    if (key === 'diff --name-only') return { status: 0, stdout: 'a.js', stderr: '' };
    if (key.startsWith('stash push')) return { status: 0, stdout: 'Saved working directory', stderr: '' };
    if (key === 'stash pop') return { status: 1, stdout: '', stderr: 'CONFLICT' };
    if (key === 'diff --name-only --diff-filter=U') return { status: 0, stdout: 'path/a.js\npath/b.js', stderr: '' };
    throw new Error(`unexpected call: ${key}`);
  };
  const result = runStashTransaction(() => ({ status: 0, stdout: '', stderr: '' }), { spawnFn });
  assert.deepStrictEqual(result, {
    committed: true,
    hookFailed: false,
    popConflict: true,
    conflictFiles: ['path/a.js', 'path/b.js'],
  });
});

test('runStashTransaction: conflictFiles fall back to parsing git CONFLICT lines', () => {
  const spawnFn = (cmd, args) => {
    const key = args.join(' ');
    if (key === 'diff --name-only') return { status: 0, stdout: 'a.js', stderr: '' };
    if (key.startsWith('stash push')) return { status: 0, stdout: 'Saved working directory', stderr: '' };
    if (key === 'stash pop') {
      return {
        status: 1,
        stdout: 'CONFLICT (content): Merge conflict in src/a.js\nCONFLICT (content): Merge conflict in src/b.js',
        stderr: '',
      };
    }
    if (key === 'diff --name-only --diff-filter=U') return { status: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected call: ${key}`);
  };
  const result = runStashTransaction(() => ({ status: 0, stdout: '', stderr: '' }), { spawnFn });
  assert.strictEqual(result.popConflict, true);
  assert.deepStrictEqual(result.conflictFiles, ['src/a.js', 'src/b.js']);
});

test('runStashTransaction: no unstaged changes -> no stash push and no stash pop', () => {
  const { spawnFn, calls } = stubGit([
    ['diff --name-only', { status: 0, stdout: '', stderr: '' }],
  ]);
  const result = runStashTransaction(() => ({ status: 0, stdout: '', stderr: '' }), { spawnFn });
  assert.deepStrictEqual(result, { committed: true, hookFailed: false, popConflict: false });
  assert.ok(!calls.some(c => c.startsWith('stash')));
});

test('runStashTransaction: noStash skips the stash entirely', () => {
  const { spawnFn, calls } = stubGit([]);
  const result = runStashTransaction(() => ({ status: 0, stdout: '', stderr: '' }), { spawnFn, noStash: true });
  assert.deepStrictEqual(result, { committed: true, hookFailed: false, popConflict: false });
  assert.strictEqual(calls.length, 0);
});

test('runStashTransaction: git stash push failure aborts before the commit is attempted', () => {
  let commitCalled = false;
  const { spawnFn } = stubGit([
    ['diff --name-only', { status: 0, stdout: 'b.txt', stderr: '' }],
    ['stash push', { status: 1, stdout: '', stderr: 'fatal: unable to write' }],
  ]);
  const result = runStashTransaction(() => { commitCalled = true; return { status: 0 }; }, { spawnFn });
  assert.strictEqual(result.committed, false);
  assert.strictEqual(result.hookFailed, false);
  assert.strictEqual(result.popConflict, false);
  assert.match(result.reason, /git stash push failed/);
  assert.strictEqual(commitCalled, false);
});

// ---------------------------------------------------------------------------
// CLI end-to-end
// ---------------------------------------------------------------------------

test('CLI --squash-execute resolves the fork-point itself and squashes the WIP commits', () => {
  const { dir, forkPoint } = makeRepoWithWip(2);
  try {
    const result = runCli(dir, ['--squash-execute']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), { status: 'squashed', forkPoint });
    assert.strictEqual(git(dir, ['rev-parse', 'HEAD']).trim(), forkPoint);
    assert.strictEqual(git(dir, ['diff', '--cached', '--name-only']).trim().split('\n').length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --squash-execute honours an explicit --fork-point from the detection output', () => {
  const { dir, forkPoint } = makeRepoWithWip(2);
  try {
    const result = runCli(dir, ['--squash-execute', '--fork-point', forkPoint]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), { status: 'squashed', forkPoint });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --stash-transaction commits and restores the stash', () => {
  const { dir } = makeRepoWithWip(0);
  try {
    fs.writeFileSync(path.join(dir, 'staged.txt'), 'staged\n');
    git(dir, ['add', 'staged.txt']);
    fs.writeFileSync(path.join(dir, 'base.txt'), 'unstaged edit\n');

    const result = runCli(dir, ['--stash-transaction', '--message', 'feat: add staged file']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      committed: true, hookFailed: false, popConflict: false,
    });
    assert.match(git(dir, ['log', '-1', '--format=%s']).trim(), /^feat: add staged file$/);
    // Stash was popped: the unstaged edit is back and no stash remains.
    assert.strictEqual(fs.readFileSync(path.join(dir, 'base.txt'), 'utf8'), 'unstaged edit\n');
    assert.strictEqual(git(dir, ['stash', 'list']).trim(), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --stash-transaction without --message exits 1 with a structured reason', () => {
  const { dir } = makeRepoWithWip(0);
  try {
    const result = runCli(dir, ['--stash-transaction']);
    assert.strictEqual(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.committed, false);
    assert.match(parsed.reason, /--message/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
