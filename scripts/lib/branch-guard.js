/**
 * branch-guard.js — shared branch-verification helper for commit/version/pr sub-skills.
 *
 * Implements R-expected-branch (issues #347, #348, #349).
 *
 * Pure function — no I/O, no child_process, no fs, no config dependencies.
 * Callers supply currentBranch (from git state) and expectedBranch (from --expected-branch flag).
 * Returns the contract shape consumed by commit/version/pr prepare scripts.
 */
'use strict';

/**
 * Validate that the current git branch matches the expected branch.
 *
 * @param {string|null|undefined} currentBranch  — result of `git branch --show-current`
 * @param {string|null|undefined} expectedBranch — value of `--expected-branch` flag
 * @returns {{ ok: boolean, currentBranch: string|null, expectedBranch: string|null, active: boolean, message: string|null }}
 */
function validateExpectedBranch(currentBranch, expectedBranch) {
  // Guard is inactive when --expected-branch was not passed.
  // Sub-skills invoked outside ship-sdlc receive no --expected-branch — guard is a no-op.
  if (!expectedBranch) {
    return { ok: true, currentBranch: currentBranch || null, expectedBranch: null, active: false, message: null };
  }

  if (currentBranch === expectedBranch) {
    return { ok: true, currentBranch, expectedBranch, active: true, message: null };
  }

  return {
    ok: false,
    currentBranch: currentBranch || null,
    expectedBranch,
    active: true,
    message: `Branch mismatch: expected '${expectedBranch}' but current is '${currentBranch || '(detached HEAD)'}'. The pipeline is configured to operate on '${expectedBranch}'. Refusing to proceed to avoid orphaning commits on the wrong branch (issues #347, #348, #349).`,
  };
}

module.exports = { validateExpectedBranch };
