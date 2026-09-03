#!/usr/bin/env node
/**
 * await-remote-review.js
 *
 * Inline-execution polling script for the ship-sdlc `await-remote-review` step.
 * Polls `gh api repos/{owner}/{repo}/pulls/{pr}/reviews` (REST) at a
 * configurable interval until a non-PENDING review from a configured
 * reviewer arrives or a timeout elapses.
 *
 * Implements R50-R56 of docs/specs/ship-sdlc.md.
 *
 * Usage:
 *   node await-remote-review.js [--pr <number>] [--timeout <s>] [--interval <s>]
 *                               [--reviewers <csv>] [--state-file <path>]
 *
 * Stdout: exactly ONE JSON line, one of:
 *   {"status":"actionable","state","reviewer","reviewId","submittedAt","prNumber"}
 *   {"status":"approved-clean","state","reviewer","reviewId","submittedAt","prNumber"}
 *   {"status":"timeout","waitedSeconds","reviewersWatched","prNumber"}
 *   {"status":"skipped","reason":"exhausted","prNumber"}
 *   {"status":"error","reason"}
 *
 * Stderr: progress logs.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const LIB = path.join(__dirname, '..', 'lib');

const { fetchPrMetadata, fetchPrReviews } = require(path.join(LIB, 'git'));
const { writeJsonLine } = require(path.join(LIB, 'output'));

// ---------------------------------------------------------------------------
// Pure helper (exported for tests) — implements R51, R52, R53, R56
// ---------------------------------------------------------------------------

/**
 * Filter PR reviews against a reviewer list and pick the latest matching review.
 *
 * Filtering rules (R56):
 *   - Excludes reviews with state === 'PENDING'.
 *   - Login match is case-insensitive.
 *   - GitHub App / Bot logins returned by the REST `pulls/{pr}/reviews` endpoint
 *     carry a trailing `[bot]` suffix (e.g. `copilot[bot]`). This suffix is
 *     stripped before comparison against the configured reviewers list so that
 *     a reviewer entry of `copilot` matches both `copilot` and `copilot[bot]`.
 *   - When the normalised reviewer login is `copilot`, also requires
 *     authorType === 'Bot' as the authoritative bot-identity guard.
 *
 * Verdict mapping (R52, R53):
 *   - state CHANGES_REQUESTED | COMMENTED → 'actionable'
 *   - state APPROVED                       → 'approved-clean'
 *   - other                                → null
 *
 * @param {Array<{id:number,state:string,authorLogin:string,authorType:string,submittedAt:string|null}>} reviews
 * @param {Array<string>} reviewers
 * @returns {{ match: object|null, status: 'actionable'|'approved-clean'|null }}
 */
function evaluateReviews(reviews, reviewers) {
  const reviewerSet = new Set((Array.isArray(reviewers) ? reviewers : []).map((r) => String(r).toLowerCase()));
  if (reviewerSet.size === 0) return { match: null, status: null };
  const list = Array.isArray(reviews) ? reviews : [];

  const matching = list.filter((r) => {
    if (!r || r.state === 'PENDING') return false;
    const login = (r.authorLogin || '').toLowerCase().replace(/\[bot\]$/, '');
    if (!reviewerSet.has(login)) return false;
    if (login === 'copilot' && r.authorType !== 'Bot') return false;
    return true;
  });

  if (matching.length === 0) return { match: null, status: null };

  // Pick latest by submittedAt; fall back to last array position when timestamps are missing/equal
  matching.sort((a, b) => {
    const at = a.submittedAt || '';
    const bt = b.submittedAt || '';
    if (at < bt) return -1;
    if (at > bt) return 1;
    return 0;
  });
  const latest = matching[matching.length - 1];

  let status = null;
  if (latest.state === 'CHANGES_REQUESTED' || latest.state === 'COMMENTED') status = 'actionable';
  else if (latest.state === 'APPROVED') status = 'approved-clean';

  return { match: latest, status };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    pr: null,
    timeout: 600,
    interval: 60,
    reviewers: ['copilot'],
    stateFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pr') out.pr = argv[++i];
    else if (a === '--timeout') out.timeout = parseInt(argv[++i], 10);
    else if (a === '--interval') out.interval = parseInt(argv[++i], 10);
    else if (a === '--reviewers') {
      const csv = argv[++i] || '';
      out.reviewers = csv.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--state-file') out.stateFile = argv[++i];
  }
  if (!Number.isFinite(out.timeout) || out.timeout < 1) out.timeout = 600;
  if (!Number.isFinite(out.interval) || out.interval < 1) out.interval = 60;
  if (out.reviewers.length === 0) out.reviewers = ['copilot'];
  return out;
}

// ---------------------------------------------------------------------------
// State-file marker helpers (R55)
// ---------------------------------------------------------------------------

function readStateFile(p) {
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeStateMarker(p, key, value) {
  if (!p) return;
  let state = readStateFile(p);
  if (!state || typeof state !== 'object') state = {};
  state[key] = value;
  try {
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
  } catch (err) {
    process.stderr.write(`await-remote-review: failed to write state marker: ${err.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Sleep via Atomics.wait (no subprocess)
// ---------------------------------------------------------------------------

function sleepMs(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// emit() is a thin alias over `lib/output.js::writeJsonLine` (issue #284,
// task 3). Each consumer call site emits ONE verdict and returns from
// `main()` — `writeJsonLine` exits the process which matches the
// previous behaviour where main returned and the script exited with code 0.
function emit(verdict) {
  writeJsonLine(verdict);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv) {
  const args = parseArgs(argv);

  // R55: short-circuit on state-marker
  if (args.stateFile) {
    const state = readStateFile(args.stateFile);
    if (state && state.awaitRemoteReviewExhausted === true) {
      emit({ status: 'skipped', reason: 'exhausted', prNumber: args.pr ? Number(args.pr) : null });
      return;
    }
  }

  let prNumber = args.pr ? Number(args.pr) : null;
  let owner = null;
  let repo = null;

  const meta = fetchPrMetadata();
  if (!meta || !meta.exists || !meta.number || !meta.owner || !meta.repo) {
    emit({ status: 'error', reason: 'no PR found for current branch (gh pr view failed)' });
    return;
  }
  if (!prNumber) prNumber = meta.number;
  owner = meta.owner;
  repo = meta.repo;

  const startedAt = Date.now();
  const timeoutMs = args.timeout * 1000;
  const intervalMs = args.interval * 1000;
  let iteration = 0;

  while (Date.now() - startedAt < timeoutMs) {
    iteration += 1;
    process.stderr.write(`await-remote-review: poll ${iteration} (PR #${prNumber}, reviewers=${args.reviewers.join(',')})\n`);
    const reviews = fetchPrReviews(owner, repo, prNumber);
    const verdict = evaluateReviews(reviews, args.reviewers);

    if (verdict.status === 'actionable' || verdict.status === 'approved-clean') {
      const m = verdict.match;
      emit({
        status: verdict.status,
        state: m.state,
        reviewer: m.authorLogin,
        reviewId: m.id,
        submittedAt: m.submittedAt,
        prNumber,
      });
      return;
    }

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    const waitMs = Math.min(intervalMs, Math.max(0, remainingMs));
    if (waitMs <= 0) break;
    sleepMs(waitMs);
  }

  // Timeout — R54
  const waitedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  if (args.stateFile) writeStateMarker(args.stateFile, 'awaitRemoteReviewExhausted', true);
  emit({ status: 'timeout', waitedSeconds, reviewersWatched: args.reviewers, prNumber });
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    emit({ status: 'error', reason: err && err.message ? err.message : String(err) });
  }
}

module.exports = { evaluateReviews };
