'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runExplorePack } = require('./plan');

// ---------------------------------------------------------------------------
// runExplorePack — SDLC_PLAN_EXPLORE_SCRIPT override (R28 test-injection hook)
// ---------------------------------------------------------------------------
// Covers the env var override introduced to avoid filesystem stubbing in
// unit tests: `process.env.SDLC_PLAN_EXPLORE_SCRIPT || path.join(__dirname,
// 'plan-explore.js')`.

function withEnv(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const prev = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    if (had) {
      process.env[name] = prev;
    } else {
      delete process.env[name];
    }
  }
}

test('runExplorePack: uses SDLC_PLAN_EXPLORE_SCRIPT override when set, ignoring the default plan-explore.js', () => {
  const tmpScript = path.join(os.tmpdir(), `mock-plan-explore-${process.pid}-${Date.now()}.js`);
  const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-plan-test-'));
  const manifestPath = path.join(tmpOutDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ marker: 'from-mock-script' }) + '\n');

  // Mock script follows the real plan-explore.js --output-file contract:
  // it prints a JSON payload's file path to stdout and exits 0.
  const mockOutputPath = path.join(tmpOutDir, 'output.json');
  fs.writeFileSync(
    mockOutputPath,
    JSON.stringify({
      manifestPath,
      outDir: tmpOutDir,
      scopeHintCount: 7,
      webResearchSignal: true,
      error: null,
    }) + '\n'
  );
  fs.writeFileSync(
    tmpScript,
    `process.stdout.write(${JSON.stringify(mockOutputPath)});\n`
  );

  try {
    const result = withEnv('SDLC_PLAN_EXPLORE_SCRIPT', tmpScript, () =>
      runExplorePack(null, 'test prompt')
    );

    assert.strictEqual(result.error, null);
    assert.strictEqual(result.manifestPath, manifestPath);
    assert.strictEqual(result.outDir, tmpOutDir);
    assert.strictEqual(result.scopeHintCount, 7);
    assert.strictEqual(result.webResearchSignal, true);
  } finally {
    fs.rmSync(tmpOutDir, { recursive: true, force: true });
    fs.rmSync(tmpScript, { force: true });
  }
});

test('runExplorePack: reports "not found" error when SDLC_PLAN_EXPLORE_SCRIPT points at a missing file', () => {
  const missingScript = path.join(os.tmpdir(), `does-not-exist-${process.pid}-${Date.now()}.js`);

  const result = withEnv('SDLC_PLAN_EXPLORE_SCRIPT', missingScript, () =>
    runExplorePack(null, 'test prompt')
  );

  assert.strictEqual(result.error, 'plan-explore.js not found');
  assert.strictEqual(result.manifestPath, null);
  assert.strictEqual(result.outDir, null);
  assert.strictEqual(result.scopeHintCount, 0);
  assert.strictEqual(result.webResearchSignal, false);
});

test('runExplorePack: falls back to the default plan-explore.js when SDLC_PLAN_EXPLORE_SCRIPT is unset', () => {
  const defaultScript = path.join(__dirname, 'plan-explore.js');
  assert.ok(fs.existsSync(defaultScript), 'default plan-explore.js must exist for the fallback to resolve');

  const result = withEnv('SDLC_PLAN_EXPLORE_SCRIPT', undefined, () =>
    runExplorePack(null, 'test prompt')
  );

  // The default script is the real plan-explore.js — it should run to
  // completion (not the "not found" error the override test above exercises)
  // and return the standard five-key shape.
  assert.notStrictEqual(result.error, 'plan-explore.js not found');
  assert.ok('manifestPath' in result);
  assert.ok('outDir' in result);
  assert.ok('scopeHintCount' in result);
  assert.ok('webResearchSignal' in result);
});
