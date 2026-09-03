#!/usr/bin/env node
/**
 * stop-state-save.js
 * Stop hook — saves a compact recovery summary of active pipeline state
 * when Antigravity finishes responding. Safety net for session crashes between
 * compactions.
 *
 * Writes to: <mainWorktree>/.sdlc/execution/.compact-recovery-<branchSlug>.json
 * (per-branch filename — issue #256; see hooks/README.md)
 *
 * Does NOT read stdin (Stop provides no tool data).
 *
 * Exit codes:
 *   0 = always (graceful degradation on errors)
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

try {
  const { findStateFile, readState, slugifyBranch, resolveStateDir } = require('../scripts/lib/state');
  const { exec } = require('../scripts/lib/git');

  const branch = exec('git branch --show-current');
  if (!branch) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
    process.exit(0);
  }

  const branchSlug = slugifyBranch(branch);

  // Fast bail — no active pipeline means no work to do
  const shipFound    = findStateFile('ship', branchSlug);
  const executeFound = findStateFile('execute', branchSlug);
  if (!shipFound && !executeFound) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
    process.exit(0);
  }

  let recovery = null;

  // Ship state takes priority
  if (shipFound) {
    const shipState = readState('ship', branchSlug);
    if (shipState && shipState.data) {
      const data = shipState.data;
      let currentStep = null;
      let reviewVerdict = null;
      let deferredFindings = 0;

      if (Array.isArray(data.steps)) {
        const inProgress = data.steps.find(s => s.status === 'in_progress');
        const lastCompleted = [...data.steps].reverse().find(s => s.status === 'completed');
        const step = inProgress || lastCompleted;
        if (step) {
          currentStep = step.name || step.id || null;
        }

        for (const s of data.steps) {
          if (s.output && s.output.deferredFindings) {
            deferredFindings = s.output.deferredFindings;
          }
          if (s.output && s.output.verdict) {
            reviewVerdict = s.output.verdict;
          }
        }
      }

      recovery = {
        savedAt: new Date().toISOString(),
        pipeline: 'ship-sdlc',
        branch: data.branch || branch,
        currentStep,
        reviewVerdict,
        deferredFindings,
        flags: {
          preset: (data.flags && data.flags.preset) || null,
          auto: (data.flags && data.flags.auto) || false,
          skip: (data.flags && data.flags.skip) || [],
        },
      };
    }
  }

  // Fall back to execute state
  if (!recovery && executeFound) {
    const executeState = readState('execute', branchSlug);
    if (executeState && executeState.data) {
      const data = executeState.data;
      let completedWaves = 0;
      let totalWaves = 0;

      if (Array.isArray(data.waves)) {
        totalWaves = data.waves.length;
        completedWaves = data.waves.filter(w => w.status === 'completed').length;
      }

      recovery = {
        savedAt: new Date().toISOString(),
        pipeline: 'execute-plan-sdlc',
        branch: data.branch || branch,
        completedWaves,
        totalWaves,
        preset: (data.preset) || null,
      };
    }
  }

  // No active pipeline — nothing to save
  if (!recovery) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
    process.exit(0);
  }

  // Write recovery file (per-branch — issue #256)
  const recoveryDir = resolveStateDir();
  fs.mkdirSync(recoveryDir, { recursive: true });

  const recoveryPath = path.join(recoveryDir, `.compact-recovery-${branchSlug}.json`);
  fs.writeFileSync(recoveryPath, JSON.stringify(recovery, null, 2), 'utf8');
} catch {
  // Graceful degradation
}

process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
process.exit(0);
