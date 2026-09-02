#!/usr/bin/env node
/**
 * execute-workspace-setup.js
 * Workspace setup for the execute-plan-sdlc pipeline.
 *
 * Node port of the former `skills/execute-plan-sdlc/scripts/workspace_setup.sh`.
 * The shell version shelled out to four separate `node -e` one-liners (two of
 * them reading `/dev/stdin`); each is now a direct `require()` of the shared
 * libs (`lib/config`, `lib/branch-name`) or an in-memory `JSON.parse`.
 *
 * This is deliberately NOT shared with `ship-workspace-setup.js`: the two
 * shell originals had drifted apart. The ship variant carries a default-branch
 * guard, a cwd assertion and a ship-state migration that this one never had;
 * this one carries a `--branch-name` override that the ship variant lacks.
 *
 * Usage:
 *   node execute-workspace-setup.js \
 *     --workspace-flag <branch|worktree|…> \
 *     --logical-type <string> \
 *     --derived-slug <string> \
 *     [--branch-name <string>]
 *
 * Steps (1:1 with the shell original):
 *   1. Resolve workspace mode (flag, else `workspace.mode` from config)
 *   2. Resolve the execute branch name (`--branch-name` wins, else
 *      `workspace.branch` config via resolveBranchName)
 *   3. Branch checkout or worktree creation
 *
 * Output (stdout, single JSON line — consumed by execute-plan-sdlc/SKILL.md):
 *   Success: {"status":"success","executeBranch":..,"worktreePath":..}
 *   Error:   {"status":"error","error":"<message>"}
 *
 * Exit codes:
 *   0 = success
 *   1 = user-facing validation error (unknown flag)
 *   2 = unexpected crash / missing sibling script
 *
 * Uses only Node.js built-in modules. No npm install required.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LIB = path.join(__dirname, '..', 'lib');

const { readSection, resolveSdlcRoot } = require(path.join(LIB, 'config'));
const { resolveBranchName } = require(path.join(LIB, 'branch-name'));
const { writeJsonLine } = require(path.join(LIB, 'output'));

// Sibling CLI — resolved relative to __dirname, so the shell version's
// `plugins/lift-sdlc/...` fallback probing is no longer needed.
const WORKTREE_CREATE_SCRIPT = path.join(__dirname, 'worktree-create.js');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse the four workspace flags. Mirrors the shell `while`/`case` loop: a
 * missing value yields an empty string, and the first unrecognised token
 * aborts parsing (the shell exited immediately on `Unknown parameter passed`).
 *
 * @param {string[]} argv  Full argv (process.argv shape).
 * @returns {{workspaceFlag:string, logicalType:string, derivedSlug:string, branchName:string, unknown:string|null}}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    workspaceFlag: '',
    logicalType:   '',
    derivedSlug:   '',
    branchName:    '',
    unknown:       null,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--workspace-flag') {
      parsed.workspaceFlag = args[++i] || '';
    } else if (a === '--logical-type') {
      parsed.logicalType = args[++i] || '';
    } else if (a === '--derived-slug') {
      parsed.derivedSlug = args[++i] || '';
    } else if (a === '--branch-name') {
      parsed.branchName = args[++i] || '';
    } else {
      parsed.unknown = a;
      break;
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a section of the unified config, tolerating any resolution failure
 * (non-git cwd, missing `.sdlc/`, unreadable JSON). The shell version achieved
 * the same by discarding stderr and falling back to an empty string.
 *
 * @param {string} section
 * @returns {object}
 */
function readSectionSafe(section) {
  try {
    return readSection(resolveSdlcRoot(), section) || {};
  } catch (_) {
    return {};
  }
}

/**
 * Step 1 — explicit flag wins, else `workspace.mode` from `.sdlc/local.json`.
 * @param {string} flag
 * @returns {string}
 */
function resolveWorkspaceMode(flag) {
  if (flag) return flag;
  return readSectionSafe('workspace').mode || '';
}

/**
 * Step 2 — `--branch-name` wins; otherwise derive the branch from the
 * `workspace.branch` config. Any failure yields '' (the shell fell back to
 * `|| echo ""`), which downstream treats as "no branch work to do".
 *
 * @param {{branchName:string, logicalType:string, derivedSlug:string}} opts
 * @returns {string}
 */
function resolveExecuteBranch(opts) {
  if (opts.branchName) return opts.branchName;
  try {
    const cfg = readSectionSafe('workspace').branch || {};
    return resolveBranchName({
      type:   opts.logicalType || 'feature',
      slug:   opts.derivedSlug || 'feature-branch',
      config: cfg,
    }) || '';
  } catch (_) {
    return '';
  }
}

/**
 * Run a git subcommand without a shell. Returns true on success.
 * @param {string[]} args
 * @returns {boolean}
 */
function runGit(args) {
  try {
    execFileSync('git', args, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Step 3 (worktree mode) — invoke the sibling `worktree-create.js` CLI once
 * and parse its JSON straight from the in-memory buffer. The shell version
 * echoed the payload into two further `node -e` processes reading
 * `/dev/stdin`.
 *
 * @param {string} branchName
 * @returns {{branch: string, path: string, error: string}}
 */
function createWorktree(branchName) {
  let raw = '';
  try {
    raw = execFileSync(process.execPath, [WORKTREE_CREATE_SCRIPT, '--name', branchName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // worktree-create.js prints its `{"error": …}` payload on stdout before
    // exiting non-zero; keep it so the reason can be surfaced on stderr.
    raw = (err && typeof err.stdout === 'string') ? err.stdout : '';
  }

  if (!raw.trim()) return { branch: '', path: '', error: '' };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { branch: '', path: '', error: '' };
  }

  return {
    branch: parsed.branch || '',
    path:   parsed.path   || '',
    error:  parsed.error  || '',
  };
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Run the three-step workspace setup.
 *
 * @param {string[]} argv  Full argv (process.argv shape).
 * @returns {{json: object|null, stderr: string, exitCode: number}}
 */
function runWorkspaceSetup(argv) {
  const opts = parseArgs(argv);

  if (opts.unknown !== null) {
    return { json: null, stderr: `Unknown parameter passed: ${opts.unknown}\n`, exitCode: 1 };
  }

  // --- 1. Resolve workspace mode -------------------------------------------
  const workspaceMode = resolveWorkspaceMode(opts.workspaceFlag);

  // --- 2. Resolve branch name ----------------------------------------------
  let executeBranch = resolveExecuteBranch(opts);

  // --- 3. Branch / worktree creation ---------------------------------------
  let worktreePath = '';
  let stderr = '';

  if (workspaceMode === 'branch' && executeBranch) {
    if (!runGit(['checkout', executeBranch])) {
      runGit(['checkout', '-b', executeBranch]);
    }
  } else if (workspaceMode === 'worktree' && executeBranch) {
    if (!fs.existsSync(WORKTREE_CREATE_SCRIPT)) {
      return {
        json: { status: 'error', error: 'Could not locate scripts/util/worktree-create.js' },
        stderr: '',
        exitCode: 2,
      };
    }

    const created = createWorktree(executeBranch);
    if (created.path)   worktreePath  = created.path;
    if (created.branch) executeBranch = created.branch;
    if (created.error)  stderr += `worktree-create.js: ${created.error}\n`;
  }

  return {
    json: { status: 'success', executeBranch, worktreePath },
    stderr,
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv) {
  const { json, stderr, exitCode } = runWorkspaceSetup(argv);
  if (stderr) process.stderr.write(stderr);
  if (json === null) process.exit(exitCode);
  writeJsonLine(json, { exitCode });
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    process.stdout.write(JSON.stringify({ status: 'error', error: `Unexpected error: ${err.message}` }) + '\n');
    process.exit(2);
  }
}

module.exports = { parseArgs, runWorkspaceSetup, main };
