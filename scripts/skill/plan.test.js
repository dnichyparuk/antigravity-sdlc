'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runExplorePack, buildLanes } = require('./plan');

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

// ---------------------------------------------------------------------------
// buildLanes — P16 lane fan-out, selection by lane.id (not positional slice)
// ---------------------------------------------------------------------------
// Regression coverage for the lanes.slice(0, 4) bug: guardrail-compliance and
// dimension-coverage are both conditionally present, so the dimension-coverage
// (G17) lane's index shifts depending on which lanes were dropped. A
// positional slice(0, 4) could pull the G17 lane back into the
// "warn on missing prompt template" loop and produce a duplicate warning
// (the G17 template failure is already warned separately via g17Dispatch.error).
// The fix selects lanes by `id` instead, so this suite asserts on the `id`
// field buildLanes() emits and confirms it stays stable regardless of position.

const FAKE_G17_DISPATCH = {
  subagentType: 'general-purpose',
  model: 'gemini-3.7-flash-medium',
  promptTemplatePath: '/fake/g17-dimension-coverage-prompt.md',
};

function makeProjectRoot({ withDimensions }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-plan-lanes-test-'));
  if (withDimensions) {
    const dimensionsDir = path.join(dir, '.sdlc', 'review-dimensions');
    fs.mkdirSync(dimensionsDir, { recursive: true });
    // validateAll() counts any *.md file in the dir toward `dimensions.length`
    // regardless of frontmatter validity — a minimal stub is enough.
    fs.writeFileSync(path.join(dimensionsDir, 'stub-dimension.md'), '# stub\n');
  }
  return dir;
}

// Mirrors the exact selection used at the lanes.slice(0, 4) call site in
// main() — kept in sync manually since the site itself is not exported.
function nonG17Lanes(lanes) {
  return lanes.filter(lane => lane.id !== 'dimension-coverage');
}

test('buildLanes: guardrails absent, dimensions present — dimension-coverage lane is excluded by id regardless of position (no duplicate G17 warning)', () => {
  const projectRoot = makeProjectRoot({ withDimensions: true });
  try {
    const lanes = buildLanes(FAKE_G17_DISPATCH, [], projectRoot);

    // guardrail-compliance is dropped (no guardrails) but dimension-coverage
    // is present, so it shifts into the position slice(0, 4) used to occupy.
    assert.strictEqual(lanes.length, 4);
    assert.deepStrictEqual(
      lanes.map(l => l.id),
      ['static-structural', 'content-coverage', 'file-existence', 'dimension-coverage']
    );

    const warnCandidates = nonG17Lanes(lanes);
    assert.deepStrictEqual(
      warnCandidates.map(l => l.id),
      ['static-structural', 'content-coverage', 'file-existence']
    );
    assert.ok(
      !warnCandidates.some(l => l.id === 'dimension-coverage'),
      'dimension-coverage lane must never reach the missing-template warning loop'
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildLanes: guardrails present, dimensions present — all lanes selected, output unchanged', () => {
  const projectRoot = makeProjectRoot({ withDimensions: true });
  try {
    const guardrails = [{ id: 'g1', description: 'stub guardrail', severity: 'error' }];
    const lanes = buildLanes(FAKE_G17_DISPATCH, guardrails, projectRoot);

    assert.strictEqual(lanes.length, 5);
    assert.deepStrictEqual(
      lanes.map(l => l.id),
      ['static-structural', 'content-coverage', 'file-existence', 'guardrail-compliance', 'dimension-coverage']
    );

    const warnCandidates = nonG17Lanes(lanes);
    assert.deepStrictEqual(
      warnCandidates.map(l => l.id),
      ['static-structural', 'content-coverage', 'file-existence', 'guardrail-compliance']
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildLanes: guardrails absent, dimensions absent — no dimension-coverage lane at all', () => {
  const projectRoot = makeProjectRoot({ withDimensions: false });
  try {
    const lanes = buildLanes(FAKE_G17_DISPATCH, [], projectRoot);

    assert.strictEqual(lanes.length, 3);
    assert.deepStrictEqual(
      lanes.map(l => l.id),
      ['static-structural', 'content-coverage', 'file-existence']
    );
    assert.deepStrictEqual(nonG17Lanes(lanes).map(l => l.id), lanes.map(l => l.id));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
