#!/usr/bin/env node
/**
 * pre-tool-file-guard.js
 * PreToolUse hook — Enforce sliced views for large files and exclude lockfiles.
 */

'use strict';

const fs = require('node:fs');

// 1. Read stdin
let input = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw.trim()) {
    input = JSON.parse(raw);
  }
} catch {
  process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
  process.exit(0);
}

const toolCall = input.toolCall || {};
const args = toolCall.args || {};
const targetFile = args.AbsolutePath || args.DirectoryPath || args.SearchPath || null;

if (!targetFile) {
  process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
  process.exit(0);
}

// 2. Lockfile exclusion
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
const isLockfile = LOCKFILES.some(lf => targetFile.endsWith(lf));

if (isLockfile) {
  process.stdout.write(JSON.stringify({ 
    decision: 'deny', 
    reason: `Reading lockfiles is prohibited as they cause massive context bloat.` 
  }) + '\n');
  process.exit(0);
}

// 3. Sliced view enforcement
if (toolCall.name === 'view_file') {
  // If StartLine or EndLine are specified, we allow it (the agent is slicing)
  if (args.StartLine || args.EndLine) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
    process.exit(0);
  }

  // Check file line count
  try {
    const stats = fs.statSync(targetFile);
    if (!stats.isFile()) {
        process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
        process.exit(0);
    }
    const content = fs.readFileSync(targetFile, 'utf8');
    const lines = content.split('\n').length;
    if (lines > 100) {
      process.stdout.write(JSON.stringify({ 
        decision: 'deny', 
        reason: `File exceeds 100 lines (${lines} lines). Please use grep_search to find relevant lines and use StartLine/EndLine parameters to read smaller slices.` 
      }) + '\n');
      process.exit(0);
    }
  } catch (err) {
    // If file doesn't exist or can't be read, let the tool handle the error natively
  }
}

process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
process.exit(0);
