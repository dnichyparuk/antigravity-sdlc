#!/usr/bin/env node
/**
 * validate-dimensions.js
 * Validates review dimension files in <project>/.sdlc/review-dimensions/
 * (issue #231; legacy <project>/.sdlc/review-dimensions/ also accepted via
 * lib/dimensions.js::resolveDimensionsDir fallback). CI script — never calls
 * verifyAndMigrate.
 *
 * Usage:
 *   node validate-dimensions.js [options]
 *
 * Options:
 *   --project-root <path>   Project root (default: cwd)
 *   --json                  JSON output to stdout (default)
 *   --markdown              Formatted markdown output to stdout
 *
 * Exit codes: 0 = all pass, 1 = issues found, 2 = script error
 *
 * Uses only Node.js built-in modules. No npm install required.
 */

'use strict';

const path = require('node:path');
const LIB = path.join(__dirname, '..', 'lib');

const { validateAll } = require(path.join(LIB, 'dimensions'));
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

function formatMarkdown(report) {
  const lines = [];
  lines.push('# Dimension Validation Report');
  lines.push('');
  lines.push(`**Overall:** ${report.overall} | ${report.summary.pass}/${report.summary.total} pass, ${report.summary.total_errors} error(s), ${report.summary.total_warnings} warning(s)`);
  lines.push('');

  if (report.dimensions.length === 0) {
    lines.push(`No dimension files found in \`${report.dimensions_dir}\`.`);
    lines.push('');
    lines.push('Run `/setup-sdlc --dimensions` to create tailored review dimensions for this project.');
    return lines.join('\n');
  }

  // Overview table
  lines.push('## Dimension Status');
  lines.push('');
  lines.push('| Dimension | File | Errors | Warnings | Status |');
  lines.push('|-----------|------|--------|----------|--------|');
  for (const d of report.dimensions) {
    const name = d.name || '(unknown)';
    lines.push(`| ${name} | ${d.file} | ${d.errors.length} | ${d.warnings.length} | ${d.status} |`);
  }
  lines.push('');

  // Issues table (only if there are any)
  const allIssues = [];
  for (const d of report.dimensions) {
    for (const e of d.errors) {
      allIssues.push({ file: d.file, check: e.check, severity: 'ERROR', message: e.message });
    }
    for (const w of d.warnings) {
      allIssues.push({ file: d.file, check: w.check, severity: 'WARNING', message: w.message });
    }
  }

  if (allIssues.length > 0) {
    lines.push('## Issues');
    lines.push('');
    lines.push('| # | File | Check | Severity | Message |');
    lines.push('|---|------|-------|----------|---------|');
    allIssues.forEach((issue, idx) => {
      lines.push(`| ${idx + 1} | ${issue.file} | ${issue.check} | ${issue.severity} | ${issue.message} |`);
    });
    lines.push('');
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

  // Exit code: 0 = all pass or warnings only, 1 = errors found, 2 = script error
  if (report.summary.total_errors > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
} catch (err) {
  process.stderr.write(`validate-dimensions.js error: ${err.message}\n`);
  process.exit(2);
}
