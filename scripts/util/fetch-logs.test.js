'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseArgs, fetchLogs } = require('./fetch-logs');

const SCRIPT = path.join(__dirname, 'fetch-logs.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs reads --pr-number', () => {
  const parsed = parseArgs(['node', '/x/fetch-logs.js', '--pr-number', '42']);
  assert.strictEqual(parsed.prNumber, '42');
  assert.strictEqual(parsed.unknown, null);
});

test('parseArgs leaves prNumber null when --pr-number is absent', () => {
  const parsed = parseArgs(['node', '/x/fetch-logs.js']);
  assert.strictEqual(parsed.prNumber, null);
});

test('parseArgs reports an unknown flag', () => {
  const parsed = parseArgs(['node', '/x/fetch-logs.js', '--bogus']);
  assert.strictEqual(parsed.unknown, '--bogus');
});

// ---------------------------------------------------------------------------
// fetchLogs — success path
// ---------------------------------------------------------------------------

test('fetchLogs prints the excerpt for the first failed check', () => {
  const res = fetchLogs(['node', '/x/fetch-logs.js', '--pr-number', '42'], {
    fetchPrChecksFn: (prNumber) => {
      assert.strictEqual(prNumber, '42');
      return [
        { bucket: 'pass', link: 'https://x/actions/runs/1' },
        { bucket: 'fail', link: 'https://github.com/o/r/actions/runs/999' },
      ];
    },
    fetchFailedCheckLogsFn: (runId, opts) => {
      assert.strictEqual(runId, '999');
      assert.deepStrictEqual(opts, { maxLines: 200 });
      return { ok: true, excerpt: 'boom: assertion failed\n' };
    },
  });

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.stdout, 'boom: assertion failed\n');
  assert.strictEqual(res.stderr, '');
});

// ---------------------------------------------------------------------------
// fetchLogs — validation error path
// ---------------------------------------------------------------------------

test('fetchLogs exits 1 when --pr-number is missing', () => {
  const res = fetchLogs(['node', '/x/fetch-logs.js']);
  assert.strictEqual(res.exitCode, 1);
  assert.strictEqual(res.stdout, '');
  assert.match(res.stderr, /--pr-number <n> is required/);
});

test('fetchLogs exits 1 when --pr-number is non-numeric', () => {
  const res = fetchLogs(['node', '/x/fetch-logs.js', '--pr-number', 'abc']);
  assert.strictEqual(res.exitCode, 1);
  assert.match(res.stderr, /--pr-number <n> is required/);
});

test('fetchLogs rejects an unknown flag on stderr', () => {
  const res = fetchLogs(['node', '/x/fetch-logs.js', '--nope']);
  assert.strictEqual(res.exitCode, 1);
  assert.match(res.stderr, /Unknown parameter passed: --nope/);
});

// ---------------------------------------------------------------------------
// fetchLogs — soft-fail paths (mirrors fetch_logs.sh's process.exit(0) branches)
// ---------------------------------------------------------------------------

test('fetchLogs exits 0 with a stderr note when no failed check is found', () => {
  const res = fetchLogs(['node', '/x/fetch-logs.js', '--pr-number', '7'], {
    fetchPrChecksFn: () => [{ bucket: 'pass', link: 'https://x/actions/runs/1' }],
  });
  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.stdout, '');
  assert.match(res.stderr, /no failed check found/);
});

test('fetchLogs exits 0 with a stderr note when the failed link has no run id', () => {
  const res = fetchLogs(['node', '/x/fetch-logs.js', '--pr-number', '7'], {
    fetchPrChecksFn: () => [{ bucket: 'fail', link: 'https://example.com/not-a-run-link' }],
  });
  assert.strictEqual(res.exitCode, 0);
  assert.match(res.stderr, /no runId in link/);
});

test('fetchLogs exits 0 with empty stdout when the log fetch itself fails', () => {
  const res = fetchLogs(['node', '/x/fetch-logs.js', '--pr-number', '7'], {
    fetchPrChecksFn: () => [{ bucket: 'fail', link: 'https://x/actions/runs/5' }],
    fetchFailedCheckLogsFn: () => ({ ok: false }),
  });
  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, '');
});

// ---------------------------------------------------------------------------
// End-to-end CLI
// ---------------------------------------------------------------------------

test('CLI exits 1 and reports the missing flag with no arguments', () => {
  const res = run([]);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--pr-number <n> is required/);
});

test('CLI exits 1 on a non-numeric --pr-number', () => {
  const res = run(['--pr-number', 'not-a-number']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--pr-number <n> is required/);
});
