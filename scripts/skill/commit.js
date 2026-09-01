#!/usr/bin/env node
/**
 * commit-prepare.js
 * Pre-computes all data needed for the commit-sdlc skill:
 * staged/unstaged state, diff content, recent commit history, and flag overrides.
 * Outputs JSON to stdout so the LLM can focus solely on message generation.
 *
 * Usage:
 *   node commit-prepare.js [options]
 *
 * Options:
 *   --no-stash       Skip stashing unstaged changes (passed through to output)
 *   --scope <s>      Override conventional commit scope (passed through to output)
 *   --type <t>       Override conventional commit type (passed through to output)
 *   --amend          Amend last commit instead of creating new (passed through to output)
 *   --auto           Skip interactive approval prompts (passed through to output)
 *   --no-squash-wip  Preserve `wip(execute):` commits instead of soft-resetting them
 *                    into the final commit (Fixes #392 / R35; passed through to output)
 *
 * Exit codes:
 *   0 = success, JSON on stdout
 *   1 = fatal error, JSON with non-empty errors[] on stdout
 *   2 = unexpected script crash, message on stderr
 *
 * Uses only Node.js built-in modules. No npm install required.
 */

'use strict';

const path = require('node:path');
const LIB = path.join(__dirname, '..', 'lib');

const { exec, checkGitState, splitDiffByFile } = require(path.join(LIB, 'git'));
const { readSection, resolveSdlcRoot } = require(path.join(LIB, 'config'));
const { writeOutput } = require(path.join(LIB, 'output'));
const { writeManifestState } = require(path.join(LIB, 'state'));
const { resolveSkipConfigCheck, ensureConfigVersion } = require(path.join(LIB, 'config-version-prepare'));
const { truncateDiff } = require(path.join(LIB, 'diff-truncate'));
const { validateExpectedBranch } = require(path.join(LIB, 'branch-guard'));

// ---------------------------------------------------------------------------
// Diff truncation
// ---------------------------------------------------------------------------

const MAX_DIFF_CHARS = 8000;

/**
 * Truncates a staged diff to MAX_DIFF_CHARS using `lib/diff-truncate.js`,
 * which is the single canonical source of large-input cap policy in the
 * corpus (issue #284, task 20). Behaviour preserved 1:1 from the previous
 * inline implementation; the helper takes `splitDiffByFile` as an injected
 * dependency to avoid a circular `lib/git.js` import.
 *
 * @param {string} fullDiff
 * @returns {{ diff: string, diffTruncated: boolean, truncatedFiles: string[] }}
 */
function truncateStagedDiff(fullDiff) {
  return truncateDiff(fullDiff, { splitDiffByFile, maxBytes: MAX_DIFF_CHARS });
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  let noStash             = false;
  let scope               = null;
  let type                = null;
  let amend               = false;
  let auto                = false;
  let noSquashWip         = false;
  let expectedBranch      = null;
  let forceDefaultBranch  = false;
  const warnings = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-stash') {
      noStash = true;
    } else if (a === '--amend') {
      amend = true;
    } else if (a === '--scope' && args[i + 1]) {
      scope = args[++i];
    } else if (a === '--type' && args[i + 1]) {
      type = args[++i];
    } else if (a === '--auto') {
      auto = true;
    } else if (a === '--no-squash-wip') {
      noSquashWip = true;
    } else if (a === '--expected-branch' && args[i + 1]) {
      // R-expected-branch (issues #347, #348, #349): validated after gitState is resolved
      expectedBranch = args[++i];
    } else if (a === '--force-default-branch') {
      forceDefaultBranch = true;
    }
  }

  return { noStash, scope, type, amend, auto, noSquashWip, expectedBranch, forceDefaultBranch, warnings };
}

// ---------------------------------------------------------------------------
// Default-branch resolution helper (R14, fixes #398)
// ---------------------------------------------------------------------------

function resolveDefaultBranch() {
  let defaultBranch = exec('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null', { cwd: process.cwd() });
  if (defaultBranch) defaultBranch = defaultBranch.trim().replace(/^refs\/remotes\/origin\//, '');
  if (!defaultBranch) {
    // Fall back: try 'main' then 'master'
    const mainExists = exec('git rev-parse --verify main 2>/dev/null', { cwd: process.cwd() });
    defaultBranch = mainExists ? 'main' : 'master';
  }
  return defaultBranch;
}

// ---------------------------------------------------------------------------
// WIP-commit squash detection (Fixes #392 / R35)
// ---------------------------------------------------------------------------

/**
 * Detects `wip(execute):` commits between the current branch's fork-point and HEAD.
 * Returns { commits: string[], stagedClean: boolean } — consumed by commit-sdlc
 * SKILL.md Step 1c to decide whether to soft-reset before generating the final
 * commit message.
 *
 * Fork-point resolution order:
 *   1. `git merge-base HEAD <upstream>` when an upstream is configured
 *   2. Detected default branch (origin/HEAD symbolic ref → main/master fallback)
 *   3. When neither resolves, returns { commits: [], stagedClean } — never errors
 */
function detectWipSquash() {
  const stagedRaw = exec('git diff --cached --name-only', { cwd: process.cwd() });
  const stagedClean = !stagedRaw || stagedRaw.split('\n').filter(Boolean).length === 0;

  let forkPoint = null;

  // Try upstream first.
  const upstream = exec('git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null', { cwd: process.cwd() });
  if (upstream && upstream.trim().length > 0) {
    const base = exec(`git merge-base HEAD ${upstream.trim()} 2>/dev/null`, { cwd: process.cwd() });
    if (base && base.trim().length > 0) forkPoint = base.trim();
  }

  // Fall back to detected default branch.
  if (!forkPoint) {
    const defaultBranch = resolveDefaultBranch();
    const base = exec(`git merge-base HEAD ${defaultBranch} 2>/dev/null`, { cwd: process.cwd() })
              || exec(`git merge-base HEAD master 2>/dev/null`, { cwd: process.cwd() });
    if (base && base.trim().length > 0) forkPoint = base.trim();
  }

  if (!forkPoint) {
    return { commits: [], stagedClean };
  }

  const logRaw = exec(`git log --format=%H%x09%s ${forkPoint}..HEAD`, { cwd: process.cwd() });
  if (!logRaw) return { commits: [], stagedClean };

  const wipPrefixRe = /^wip\(execute\)/;
  const commits = logRaw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const tabIdx = line.indexOf('\t');
      if (tabIdx < 0) return null;
      return { sha: line.slice(0, tabIdx), subject: line.slice(tabIdx + 1) };
    })
    .filter(e => e && wipPrefixRe.test(e.subject))
    .map(e => e.sha);

  return { commits, stagedClean };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const projectRoot = resolveSdlcRoot(); // issue #351: route to main worktree .sdlc/
  const { noStash, scope, type, amend, auto, noSquashWip, expectedBranch, forceDefaultBranch, warnings: parseWarnings } = parseArgs(process.argv);

  const errors   = [];
  const warnings = [...parseWarnings];

  // Issue #232: verifyAndMigrate gate (CLI > env > default false).
  const skipConfigCheck = resolveSkipConfigCheck(process.argv);
  const cv = ensureConfigVersion(projectRoot, { skip: skipConfigCheck, roles: ['project'] });
  if (cv.errors.length > 0) {
    for (const e of cv.errors) errors.push(`config-version: ${e.role}: ${e.message}`);
    writeOutput({ errors, warnings, flags: { skipConfigCheck }, migration: cv.migration }, 'commit-context', 1);
    return;
  }

  const flags = { noStash, scope, type, amend, auto, noSquashWip, skipConfigCheck, forceDefaultBranch };

  // Step 3: Validate git repo and get current branch
  let gitState;
  try {
    gitState = checkGitState(process.cwd());
  } catch (err) {
    errors.push(err.message);
    writeOutput({ errors, warnings }, 'commit-context', 1);
    return;
  }

  const { currentBranch } = gitState;

  // Default-branch detection (R14, fixes #398)
  const defaultBranch = resolveDefaultBranch();
  const onDefaultBranch = currentBranch === defaultBranch;

  // Branch-guard HARD GATE (R-expected-branch, issues #347, #348, #349)
  // Must run before any git commit invocation. Pure check — exits immediately on mismatch.
  const branchGuard = validateExpectedBranch(currentBranch, expectedBranch);
  if (branchGuard.active && !branchGuard.ok) {
    process.stderr.write(branchGuard.message + '\n');
    writeOutput({ errors: [branchGuard.message], warnings, currentBranch, branchGuard }, 'commit-context', 3);
    return;
  }

  // Step 3b: Read commit config
  let commitConfig = null;
  try {
    commitConfig = readSection(projectRoot, 'commit');
  } catch (err) {
    warnings.push(`Could not read commit config: ${err.message}`);
  }

  // Step 3c: Validate flags against config
  if (type && commitConfig?.allowedTypes && Array.isArray(commitConfig.allowedTypes) && commitConfig.allowedTypes.length > 0) {
    if (!commitConfig.allowedTypes.includes(type)) {
      errors.push(`Commit type "${type}" is not allowed. Allowed types: ${commitConfig.allowedTypes.join(', ')}`);
    }
  }

  if (scope && commitConfig?.allowedScopes && Array.isArray(commitConfig.allowedScopes) && commitConfig.allowedScopes.length > 0) {
    if (!commitConfig.allowedScopes.includes(scope)) {
      errors.push(`Commit scope "${scope}" is not allowed. Allowed scopes: ${commitConfig.allowedScopes.join(', ')}`);
    }
  }

  // Step 4: Get staged files
  const stagedRaw   = exec('git diff --cached --name-only', { cwd: process.cwd() });
  const stagedFiles = stagedRaw ? stagedRaw.split('\n').filter(Boolean) : [];

  // Detect wip(execute): commits since fork-point BEFORE the staged-files
  // gate (Fixes #392 / R35). When the user has only wip(execute): commits
  // and no staged changes on top, commit-sdlc SKILL.md Step 1c will
  // soft-reset to fork-point and re-stage — at that point the staged set
  // becomes non-empty. The prepare output therefore must surface
  // `wipSquash` even on the early "nothing staged" path so SKILL.md can
  // make the squash decision before erroring out to the user.
  let wipSquashEarly;
  try {
    wipSquashEarly = detectWipSquash();
  } catch (err) {
    warnings.push(`Could not detect wip(execute): commits for squash: ${err.message}`);
    wipSquashEarly = { commits: [], stagedClean: true };
  }

  // Step 5: Error if nothing staged and not amending
  if (stagedFiles.length === 0 && !amend) {
    // When there are wip(execute): commits to squash, the "nothing staged"
    // condition is resolvable via Step 1c soft-reset — surface wipSquash so
    // SKILL.md can detect this and proceed without surfacing the error.
    if (wipSquashEarly.commits.length === 0) {
      errors.push('No staged changes. Use `git add` to stage files before committing.');
    }
    writeOutput({ errors, warnings, currentBranch, flags, wipSquash: wipSquashEarly }, 'commit-context', errors.length > 0 ? 1 : 0);
    return;
  }

  // Step 5b: Warn when amending with no staged files
  if (stagedFiles.length === 0 && amend) {
    warnings.push('No staged changes. The amended commit will have the same file changes as the original.');
  }

  // Step 6: Get staged diff (may be empty when --amend with nothing staged)
  const stagedDiff = exec('git diff --cached', { cwd: process.cwd() }) || '';
  const { diff: finalDiff, diffTruncated, truncatedFiles } = truncateStagedDiff(stagedDiff);

  // Step 7: Get staged diff stat
  const stagedDiffStat = exec('git diff --cached --stat', { cwd: process.cwd() }) || '';

  // Step 8: Get unstaged files
  const unstagedRaw   = exec('git diff --name-only', { cwd: process.cwd() });
  const unstagedFiles = unstagedRaw ? unstagedRaw.split('\n').filter(Boolean) : [];

  // Step 9: Get untracked files
  const untrackedRaw   = exec('git ls-files --others --exclude-standard', { cwd: process.cwd() });
  const untrackedFiles = untrackedRaw ? untrackedRaw.split('\n').filter(Boolean) : [];

  // Step 10: Get recent commits
  const commitsRaw    = exec('git log --oneline -5', { cwd: process.cwd() });
  const recentCommits = commitsRaw ? commitsRaw.split('\n').filter(Boolean) : [];

  // Step 11: Get last commit message when amending
  let lastCommitMessage = null;
  if (amend) {
    const raw = exec('git log -1 --format=%B', { cwd: process.cwd() });
    lastCommitMessage = raw !== null ? raw.trim() : null;
  }

  // Step 12: Warn when amending on a protected branch
  if (amend && (currentBranch === 'main' || currentBranch === 'master')) {
    warnings.push(`You are on ${currentBranch}. Amending commits on a protected branch may cause issues.`);
  }

  // Default-branch guard (R14/C12, fixes #398)
  if (onDefaultBranch) {
    warnings.push(`Committing to default branch '${defaultBranch}' — this lands directly on the protected branch.`);
    if (auto && !forceDefaultBranch) {
      errors.push(`Refusing to --auto commit to default branch '${defaultBranch}'. Pass --force-default-branch to override, or remove --auto for interactive approval.`);
    }
  }

  // Step 13 (Fixes #392 / R35): wip(execute): squash detection — reuse the
  // result computed earlier (we always run detectWipSquash before the staged
  // gate so wipSquash is available even on the empty-staging path).
  const wipSquash = wipSquashEarly;

  const result = {
    errors,
    warnings,
    currentBranch,
    defaultBranch,
    onDefaultBranch,
    flags,
    migration: cv.migration,
    commitConfig,
    staged: {
      files:          stagedFiles,
      fileCount:      stagedFiles.length,
      diff:           finalDiff,
      diffStat:       stagedDiffStat,
      diffTruncated,
      truncatedFiles,
    },
    unstaged: {
      files:      unstagedFiles,
      fileCount:  unstagedFiles.length,
      hasChanges: unstagedFiles.length > 0,
    },
    untracked: {
      files:     untrackedFiles,
      fileCount: untrackedFiles.length,
    },
    recentCommits,
    lastCommitMessage,
    wipSquash,
    branchGuard,
  };

  const manifestPath = writeManifestState('commit', currentBranch, result);
  process.stdout.write(manifestPath + '\n');
  process.exit(result.errors && result.errors.length > 0 ? 1 : 0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`commit-prepare.js error: ${err.message}\n${err.stack}\n`);
    process.exit(2);
  }
}

module.exports = { parseArgs };
