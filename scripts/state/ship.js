#!/usr/bin/env node
/**
 * ship-state.js
 * CLI wrapper for managing ship-sdlc execution state files.
 * Delegates all I/O to lib/state.js; zero npm dependencies.
 *
 * Usage:
 *   node ship-state.js init               --branch <b> --flags <json>
 *   node ship-state.js start              --step <name>
 *   node ship-state.js complete           --step <name> --result <text>
 *   node ship-state.js skip               --step <name> --reason <text>
 *   node ship-state.js fail               --step <name> --error <text>
 *   node ship-state.js decide             --step <name> --text <text>
 *   node ship-state.js defer              --severity <s> --file <f> [--line <n>] --title <t>
 *   node ship-state.js read               [--branch <b>]
 *   node ship-state.js cleanup            [--branch <b>]                    # legacy alias of cleanup-pipeline (no GC sweep)
 *   node ship-state.js cleanup-pipeline   [--force] [--ttl-days <N>]        # terminal pipeline cleanup + GC sweep
 *   node ship-state.js gc                 [--ttl-days <N>] [--dry-run]      # on-demand GC of stale ship- and execute- state
 *   node ship-state.js migrate            --from <slug> --to <branch>       # rename ship-state file when branch changes
 *
 * Exit codes:
 *   0 = success
 *   1 = state file not found (read/cleanup) or step not found
 *   2 = unexpected error
 */

'use strict';

const path = require('node:path');
const fs   = require('node:fs');
const LIB = path.join(__dirname, '..', 'lib');

const {
  slugifyBranch,
  readState, writeState, initState, deleteState, resolveBranch,
  gcStateFiles, pruneStateFiles, migrateBranchSlug,
  listBranches, readTtlDaysFromConfig,
} = require(path.join(LIB, 'state'));

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { subcommand: args[0] || null };

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--branch' && args[i + 1]) {
      result.branch = args[++i];
    } else if (a === '--flags' && args[i + 1]) {
      result.flags = args[++i];
    } else if (a === '--step' && args[i + 1]) {
      result.step = args[++i];
    } else if (a === '--result' && args[i + 1]) {
      result.result = args[++i];
    } else if (a === '--reason' && args[i + 1]) {
      result.reason = args[++i];
    } else if (a === '--error' && args[i + 1]) {
      result.error = args[++i];
    } else if (a === '--text' && args[i + 1]) {
      result.text = args[++i];
    } else if (a === '--severity' && args[i + 1]) {
      result.severity = args[++i];
    } else if (a === '--file' && args[i + 1]) {
      result.file = args[++i];
    } else if (a === '--line' && args[i + 1]) {
      result.line = args[++i];
    } else if (a === '--title' && args[i + 1]) {
      result.title = args[++i];
    } else if (a === '--ttl-days' && args[i + 1]) {
      const val = parseInt(args[++i], 10);
      if (isNaN(val)) { process.stderr.write(`Error: --ttl-days requires a number, got "${args[i]}"\n`); process.exit(2); }
      result.ttlDays = val;
    } else if (a === '--dry-run') {
      result.dryRun = true;
    } else if (a === '--force') {
      result.force = true;
    } else if (a === '--from' && args[i + 1]) {
      result.from = args[++i];
    } else if (a === '--to' && args[i + 1]) {
      result.to = args[++i];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Branch resolution
// ---------------------------------------------------------------------------

function resolveBranchOrExit(argBranch) {
  try {
    return resolveBranch(argBranch);
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function cmdInit(opts) {
  if (!opts.branch) {
    process.stderr.write('Error: --branch is required for init\n');
    process.exit(2);
  }

  let flags;
  try {
    flags = opts.flags ? JSON.parse(opts.flags) : {};
  } catch (e) {
    process.stderr.write(`Error: --flags is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }

  const data = {
    version: 1,
    startedAt: new Date().toISOString(),
    branch: opts.branch,
    flags,
    steps: [
      { name: 'execute',         status: 'pending' },
      { name: 'commit',          status: 'pending' },
      { name: 'review',          status: 'pending' },
      { name: 'received-review', status: 'pending', condition: 'if critical/high findings' },
      { name: 'commit-fixes',    status: 'pending', condition: 'if received-review made changes' },
      { name: 'version',         status: 'pending' },
      { name: 'pr',              status: 'pending' },
    ],
    decisions: [],
    deferredFindings: [],
  };

  try {
    // R-ship-init-prune (issue #255): remove any pre-existing same-branch ship-state
    // files before claiming the branch with a new init. These are guaranteed orphans
    // (one branch hosts one active ship pipeline) — typically left behind by runs
    // interrupted before the terminal cleanup step (e.g., context compaction).
    const branchSlug = slugifyBranch(opts.branch);
    const prunedOrphans = pruneStateFiles('ship', branchSlug);

    const filePath = initState('ship', opts.branch, data);
    process.stdout.write(JSON.stringify({ filePath, prunedOrphans }) + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(2);
  }
}

function cmdStart(opts) {
  if (!opts.step) {
    process.stderr.write('Error: --step is required\n');
    process.exit(2);
  }

  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);
  if (!found) {
    process.stderr.write(`Error: no state file found for branch "${branch}"\n`);
    process.exit(1);
  }

  const { data, filePath } = found;
  const step = data.steps.find(s => s.name === opts.step);
  if (!step) {
    process.stderr.write(`Error: step "${opts.step}" not found\n`);
    process.exit(1);
  }

  step.status = 'in_progress';
  step.startedAt = new Date().toISOString();

  writeState(filePath, data);
  process.exit(0);
}

function cmdComplete(opts) {
  if (!opts.step) {
    process.stderr.write('Error: --step is required\n');
    process.exit(2);
  }

  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);
  if (!found) {
    process.stderr.write(`Error: no state file found for branch "${branch}"\n`);
    process.exit(1);
  }

  const { data, filePath } = found;
  const step = data.steps.find(s => s.name === opts.step);
  if (!step) {
    process.stderr.write(`Error: step "${opts.step}" not found\n`);
    process.exit(1);
  }

  step.status = 'completed';
  step.completedAt = new Date().toISOString();
  if (opts.result !== undefined) step.result = opts.result;

  writeState(filePath, data);
  process.exit(0);
}

function cmdSkip(opts) {
  if (!opts.step) {
    process.stderr.write('Error: --step is required\n');
    process.exit(2);
  }

  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);
  if (!found) {
    process.stderr.write(`Error: no state file found for branch "${branch}"\n`);
    process.exit(1);
  }

  const { data, filePath } = found;
  const step = data.steps.find(s => s.name === opts.step);
  if (!step) {
    process.stderr.write(`Error: step "${opts.step}" not found\n`);
    process.exit(1);
  }

  step.status = 'skipped';
  step.completedAt = new Date().toISOString();
  if (opts.reason !== undefined) step.reason = opts.reason;

  writeState(filePath, data);
  process.exit(0);
}

function cmdFail(opts) {
  if (!opts.step) {
    process.stderr.write('Error: --step is required\n');
    process.exit(2);
  }

  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);
  if (!found) {
    process.stderr.write(`Error: no state file found for branch "${branch}"\n`);
    process.exit(1);
  }

  const { data, filePath } = found;
  const step = data.steps.find(s => s.name === opts.step);
  if (!step) {
    process.stderr.write(`Error: step "${opts.step}" not found\n`);
    process.exit(1);
  }

  step.status = 'failed';
  if (opts.error !== undefined) step.error = opts.error;

  writeState(filePath, data);
  process.exit(0);
}

function cmdDecide(opts) {
  if (!opts.step) {
    process.stderr.write('Error: --step is required\n');
    process.exit(2);
  }

  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);
  if (!found) {
    process.stderr.write(`Error: no state file found for branch "${branch}"\n`);
    process.exit(1);
  }

  const { data, filePath } = found;
  if (!Array.isArray(data.decisions)) data.decisions = [];
  data.decisions.push({ step: opts.step, decision: opts.text || '' });

  writeState(filePath, data);
  process.exit(0);
}

function cmdDefer(opts) {
  if (!opts.severity || !opts.file || !opts.title) {
    process.stderr.write('Error: --severity, --file, and --title are required\n');
    process.exit(2);
  }

  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);
  if (!found) {
    process.stderr.write(`Error: no state file found for branch "${branch}"\n`);
    process.exit(1);
  }

  const { data, filePath } = found;
  if (!Array.isArray(data.deferredFindings)) data.deferredFindings = [];
  data.deferredFindings.push({
    severity: opts.severity,
    file: opts.file,
    line: opts.line != null ? opts.line : null,
    title: opts.title,
  });

  writeState(filePath, data);
  process.exit(0);
}

function cmdRead(opts) {
  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);
  if (!found) {
    process.stderr.write(`Error: no state file found for branch "${branch}"\n`);
    process.exit(1);
  }

  process.stdout.write(JSON.stringify(found.data, null, 2) + '\n');
  process.exit(0);
}

/**
 * Validate pipeline contract for the current run's state file.
 * Returns { valid, violations } without doing any I/O on the file.
 *
 * @param {object} stateData  parsed JSON content of the state file
 */
function validatePipelineContract(stateData) {
  const violations = [];
  for (const step of (stateData.steps || [])) {
    if (step.status === 'pending' || step.status === 'in_progress') {
      violations.push({ step: step.name, status: step.status });
    }
  }
  return {
    valid: violations.length === 0,
    violations: violations.map(v => ({
      step: v.step,
      actualStatus: v.status,
      message: `Step "${v.step}" has status "${v.status}" — expected completed, skipped, or failed`,
    })),
  };
}

/**
 * Legacy `cleanup` subcommand — kept for back-compat with callers from
 * earlier plugin versions (same plugin, pre-#223). Behavior matches the old
 * script exactly: validate contract + delete current state file, no GC sweep.
 * New callers should use `cleanup-pipeline` (which is identical on success
 * and additionally runs the GC sweep, plus supports --force for failure paths).
 */
function cmdCleanup(opts) {
  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);
  if (!found) {
    // Nothing to delete — treat as success
    process.exit(0);
  }

  const contract = validatePipelineContract(found.data);
  if (!contract.valid) {
    process.stdout.write(JSON.stringify({ valid: false, violations: contract.violations }, null, 2) + '\n');
    process.stderr.write(`Pipeline contract violation: ${contract.violations.length} step(s) not in terminal state. State file preserved.\n`);
    process.exit(1);
  }

  deleteState(found.filePath);
  process.stdout.write(JSON.stringify({ valid: true, cleaned: true }, null, 2) + '\n');
  process.exit(0);
}

/**
 * `cleanup-pipeline` — terminal pipeline action. On success paths:
 *   1. validate pipeline contract; on violation, exit 1 (preserve state file)
 *   2. delete the current run's state file
 *   3. GC sweep stale ship- and execute- state files older than TTL whose
 *      branch is no longer in `git branch --list`
 *   4. emit one combined JSON report and exit 0
 *
 * With `--force` (failure paths):
 *   - skip contract validation
 *   - preserve the current run's state file (so --resume still works)
 *   - run only the GC sweep
 */
function cmdCleanupPipeline(opts) {
  const branch = resolveBranchOrExit(opts.branch);
  const slug = slugifyBranch(branch);
  const found = readState('ship', slug);

  const ttlDays = (typeof opts.ttlDays === 'number') ? opts.ttlDays : readTtlDaysFromConfig();
  const knownBranches = listBranches();

  const report = {
    currentRun: { valid: true, cleaned: false },
    gc: { ship: { deleted: [], kept: [] }, execute: { deleted: [], kept: [] }, plan: { deleted: [], kept: [] } },
    force: !!opts.force,
    ttlDays,
  };

  if (opts.force) {
    // Failure path: preserve current state file, only run GC sweep.
    report.currentRun = { valid: null, cleaned: false, preservedReason: 'force' };
  } else if (!found) {
    // Nothing to delete — already cleaned.
    report.currentRun = { valid: true, cleaned: false, reason: 'no-state-file' };
  } else {
    const contract = validatePipelineContract(found.data);
    if (!contract.valid) {
      report.currentRun = { valid: false, cleaned: false, violations: contract.violations };
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      process.stderr.write(`Pipeline contract violation: ${contract.violations.length} step(s) not in terminal state. State file preserved.\n`);
      process.exit(1);
    }
    deleteState(found.filePath);
    report.currentRun = { valid: true, cleaned: true };
  }

  // GC sweep for all three prefixes
  report.gc.ship    = gcStateFiles({ prefix: 'ship',    ttlDays, knownBranches });
  report.gc.execute = gcStateFiles({ prefix: 'execute', ttlDays, knownBranches });
  report.gc.plan    = gcStateFiles({ prefix: 'plan',    ttlDays, knownBranches });
  report.gc.commit  = gcStateFiles({ prefix: 'commit',  ttlDays, knownBranches });

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

/**
 * `gc` — on-demand GC sweep across both ship- and execute- state files.
 * Honors --dry-run and --ttl-days.
 */
function cmdGc(opts) {
  const ttlDays = (typeof opts.ttlDays === 'number') ? opts.ttlDays : readTtlDaysFromConfig();
  const knownBranches = listBranches();

  if (opts.dryRun) {
    // Dry-run: enumerate without deleting. Re-implement with `now`/`fs.statSync`
    // pre-flight to compute what would happen, by temporarily filtering.
    const { resolveStateDir, parseStateFilename } = require(path.join(LIB, 'state'));
    const stateDir = resolveStateDir();
    const liveSlugs = new Set(knownBranches.map(slugifyBranch));
    const now = Date.now();
    const ttlMs = ttlDays * 86400000;

    const out = { ship: { wouldDelete: [], wouldKeep: [] }, execute: { wouldDelete: [], wouldKeep: [] }, plan: { wouldDelete: [], wouldKeep: [] } };

    let entries = [];
    try { entries = fs.readdirSync(stateDir); } catch (_) { /* empty */ }

    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const parsed = parseStateFilename(name);
      if (!parsed) continue;
      const bucket = out[parsed.prefix];
      if (!bucket) continue;
      let stat;
      try { stat = fs.statSync(path.join(stateDir, name)); } catch (_) { continue; }
      const fresh = (now - stat.mtimeMs) < ttlMs;
      const branchExists = liveSlugs.has(parsed.slug);
      if (fresh) {
        bucket.wouldKeep.push({ file: name, branch: parsed.slug, reason: 'ttl-fresh' });
      } else if (branchExists) {
        bucket.wouldKeep.push({ file: name, branch: parsed.slug, reason: 'branch-exists' });
      } else {
        bucket.wouldDelete.push({ file: name, branch: parsed.slug, reason: 'stale+branch-gone' });
      }
    }

    process.stdout.write(JSON.stringify({ dryRun: true, ttlDays, ...out }, null, 2) + '\n');
    process.exit(0);
  }

  const ship    = gcStateFiles({ prefix: 'ship',    ttlDays, knownBranches });
  const execute = gcStateFiles({ prefix: 'execute', ttlDays, knownBranches });
  const plan    = gcStateFiles({ prefix: 'plan',    ttlDays, knownBranches });
  const commit  = gcStateFiles({ prefix: 'commit',  ttlDays, knownBranches });

  process.stdout.write(JSON.stringify({ ttlDays, ship, execute, plan, commit }, null, 2) + '\n');
  process.exit(0);
}

/**
 * `migrate` — rename a ship-state file from one branch slug to another and
 * update `data.branch`. Used by ship-sdlc when execute-plan-sdlc creates a
 * new branch mid-pipeline.
 */
function cmdMigrate(opts) {
  if (!opts.from || !opts.to) {
    process.stderr.write('Error: --from <slug> and --to <branch> are required for migrate\n');
    process.exit(2);
  }

  const result = migrateBranchSlug({ prefix: 'ship', fromSlug: opts.from, toBranch: opts.to });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.migrated ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  const opts = parseArgs(process.argv);

  switch (opts.subcommand) {
    case 'init':     cmdInit(opts);     break;
    case 'start':    cmdStart(opts);    break;
    case 'complete': cmdComplete(opts); break;
    case 'skip':     cmdSkip(opts);     break;
    case 'fail':     cmdFail(opts);     break;
    case 'decide':   cmdDecide(opts);   break;
    case 'defer':    cmdDefer(opts);    break;
    case 'read':     cmdRead(opts);     break;
    case 'cleanup':           cmdCleanup(opts);          break;
    case 'cleanup-pipeline':  cmdCleanupPipeline(opts);  break;
    case 'gc':                cmdGc(opts);               break;
    case 'migrate':           cmdMigrate(opts);          break;
    default:
      process.stderr.write(`Error: unknown subcommand "${opts.subcommand}"\n`);
      process.stderr.write('Usage: node ship-state.js <init|start|complete|skip|fail|decide|defer|read|cleanup|cleanup-pipeline|gc|migrate> [options]\n');
      process.exit(2);
  }
} catch (e) {
  process.stderr.write(`Unexpected error: ${e.message}\n`);
  process.exit(2);
}
