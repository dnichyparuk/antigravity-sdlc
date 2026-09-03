#!/usr/bin/env node
/**
 * validate-discovery.js
 * Validates the plugin discovery and cross-reference chain.
 *
 * Checks that plugin.json, skills, scripts, hooks, and agents are correctly
 * wired so the plugin works after installation.
 *
 * Usage:
 *   node validate-discovery.js [options]
 *
 * Options:
 *   --project-root <path>   Plugin root directory (default: cwd)
 *   --json                  JSON output to stdout (default)
 *   --markdown              Formatted markdown report to stdout
 *
 * Exit codes: 0 = all pass, 1 = issues found, 2 = script error
 *
 * Uses only Node.js built-in modules. No npm install required.
 */

'use strict';

const path = require('node:path');
const LIB = path.join(__dirname, '..', 'lib');

const { validateAll } = require(path.join(LIB, 'discovery'));
const { resolveSdlcRoot } = require(path.join(LIB, 'config'));

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  // C-projectroot (#360): default to main-worktree .sdlc/ root, not cwd.
  let projectRoot = resolveSdlcRoot();
  let outputFormat = 'json';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--project-root' && args[i + 1]) {
      projectRoot = path.resolve(args[++i]);
    } else if (a === '--json') {
      outputFormat = 'json';
    } else if (a === '--markdown') {
      outputFormat = 'markdown';
    }
  }

  return { projectRoot, outputFormat };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatJson(report) {
  return JSON.stringify(report, null, 2);
}

const STATUS_ICON = { pass: '✓', fail: '✗', skip: '–' };
const SEV_LABEL   = { error: 'ERROR', warning: 'WARNING' };

function formatMarkdown(report) {
  const lines = [];
  lines.push('# Plugin Discovery Validation Report');
  lines.push('');

  const overall = report.overall === 'pass' ? 'PASS' : 'FAIL';
  const { total, pass: passed, fail: failed, total_errors, total_warnings } = report.summary;
  lines.push(
    `**Overall:** ${overall} | ${passed}/${total} pass, ` +
    `${total_errors} error(s), ${total_warnings} warning(s)`
  );
  lines.push('');

  lines.push('## Checks');
  lines.push('');
  lines.push('| ID | Check | Status | Severity |');
  lines.push('|----|-------|--------|----------|');
  for (const c of report.checks) {
    const icon = STATUS_ICON[c.status] || '?';
    const sev  = c.status === 'skip' ? '–' : (SEV_LABEL[c.severity] || c.severity);
    lines.push(`| ${c.id} | ${c.check} | ${icon} ${c.status.toUpperCase()} | ${sev} |`);
  }
  lines.push('');

  const failures = report.checks.filter(c => c.status === 'fail');
  if (failures.length > 0) {
    lines.push('## Issues');
    lines.push('');
    for (const c of failures) {
      const sev = SEV_LABEL[c.severity] || c.severity;
      lines.push(`### [${c.id}] ${c.check} (${sev})`);
      lines.push('');
      lines.push(c.message);
      if (c.details && c.details.length > 0) {
        lines.push('');
        for (const d of c.details) {
          lines.push(`- ${d}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

try {
  const { projectRoot, outputFormat } = parseArgs(process.argv);
  const report = validateAll(projectRoot);

  if (outputFormat === 'markdown') {
    process.stdout.write(formatMarkdown(report) + '\n');
  } else {
    process.stdout.write(formatJson(report) + '\n');
  }

  process.exit(report.summary.total_errors > 0 ? 1 : 0);
} catch (err) {
  process.stderr.write(`validate-discovery.js error: ${err.message}\n`);
  process.exit(2);
}
