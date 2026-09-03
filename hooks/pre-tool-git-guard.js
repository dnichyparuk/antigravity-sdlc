#!/usr/bin/env node
/**
 * pre-tool-git-guard.js
 * PreToolUse hook — intercepts dangerous git commands before execution.
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
  // Stdin unreadable or non-JSON — fail closed. An unparseable payload is
  // exactly the anomalous condition this guard must not treat as
  // "nothing to check here" (a malformed payload must not let
  // `git push --force`/`reset --hard`/`checkout .`/`clean -f` through unchecked).
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'pre-tool-git-guard.js: could not parse tool-call input as JSON (fail-closed). If this repeats for every command, the host is sending malformed payloads — inspect hooks.json or temporarily disable this hook.' }) + '\n');
  process.exit(0);
}

// 2. Extract command
const toolCall = input.toolCall || {};
const args = toolCall.args || {};
const command = args.CommandLine || args.command || '';

if (!command.includes('git ')) {
  process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
  process.exit(0);
}

// 3. Dangerous command patterns
const BLOCKED = [
  {
    test: (cmd) => /\bgit\s+push\b[^;&|]*(?:--force(?!-with-lease)|-f\b)/.test(cmd),
    message: 'Blocked: git push --force can destroy remote history. Use --force-with-lease for a safer alternative.',
  },
  {
    test: (cmd) => /\bgit\s+reset\s+--hard\b/.test(cmd),
    message: 'Blocked: git reset --hard discards all uncommitted changes. Use git stash or git reset --soft instead.',
  },
  {
    test: (cmd) => /\bgit\s+checkout\s+(--\s+)?\./.test(cmd),
    message: 'Blocked: git checkout . discards all uncommitted changes. Use git stash to preserve changes.',
  },
  {
    test: (cmd) => /\bgit\s+clean\s+[^;&|]*-[a-zA-Z]*f/.test(cmd),
    message: 'Blocked: git clean -f permanently deletes untracked files. Use git clean -n for a dry run first.',
  },
];

for (const rule of BLOCKED) {
  if (rule.test(command)) {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: rule.message }) + '\n');
    process.exit(0);
  }
}

process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
process.exit(0);
