#!/usr/bin/env node
/**
 * validate-pr-template.js
 * Validates the PR template file at <project-root>/.sdlc/pr-template.md.
 *
 * Usage:
 *   node validate-pr-template.js [options]
 *
 * Options:
 *   --project-root <path>   Project root (default: cwd)
 *   --json                  JSON output to stdout
 *   --markdown              Formatted markdown table output to stdout (default)
 *
 * Exit codes: 0 = all checks passed, 1 = one or more checks failed
 *
 * Uses only Node.js built-in modules. No npm install required.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolvePrTemplatePath } = require('../lib/pr-template');
const { resolveSdlcRoot } = require('../lib/config');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

/**
 * Parse process.argv into structured options.
 *
 * @param {string[]} argv - process.argv
 * @returns {{ projectRoot: string, outputFormat: 'json'|'markdown' }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  // C-projectroot (#360): default to main-worktree .sdlc/ root, not cwd.
  let projectRoot = resolveSdlcRoot();
  let outputFormat = 'markdown';

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
// Validation logic
// ---------------------------------------------------------------------------

/**
 * Parse sections from file content.
 * A section heading is a line starting with exactly `## ` (two hashes + space).
 * Lines starting with `### ` or more hashes are not treated as section headings.
 *
 * @param {string} content - raw file content
 * @returns {Array<{ name: string, body: string }>}
 */
function parseSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentHeading = null;
  let bodyLines = [];

  for (const line of lines) {
    if (/^## (?!#)/.test(line)) {
      if (currentHeading !== null) {
        sections.push({ name: currentHeading, body: bodyLines.join('\n').trim() });
      }
      currentHeading = line.slice(3).trim();
      bodyLines = [];
    } else {
      if (currentHeading !== null) {
        bodyLines.push(line);
      }
    }
  }

  if (currentHeading !== null) {
    sections.push({ name: currentHeading, body: bodyLines.join('\n').trim() });
  }

  return sections;
}

/**
 * Run all validation checks against the PR template file.
 *
 * @param {string} projectRoot - absolute path to the project root
 * @returns {{ passed: boolean, checks: Array<{ id: string, description: string, status: string, detail: string }> }}
 */
function validatePrTemplate(projectRoot) {
  // Issue #260: route through single-source resolver so .sdlc/-first lookup works.
  // When neither location exists, default to the canonical path so the
  // "missing template" check reports the canonical location.
  const resolved = resolvePrTemplatePath(projectRoot);
  const templatePath = resolved || path.join(projectRoot, '.sdlc', 'pr-template.md');
  const relativePath = path.relative(projectRoot, templatePath);

  const checks = [];
  let passed = true;

  /**
   * Record a check result and return whether it passed.
   *
   * @param {string} id
   * @param {string} description
   * @param {boolean} ok
   * @param {string} detail
   * @returns {boolean}
   */
  function addCheck(id, description, ok, detail) {
    checks.push({
      id,
      description,
      status: ok ? 'PASS' : 'FAIL',
      detail,
    });
    if (!ok) {
      passed = false;
    }
    return ok;
  }

  // V1: File exists
  const fileExists = fs.existsSync(templatePath);
  const v1ok = addCheck(
    'V1',
    'File exists',
    fileExists,
    fileExists
      ? `Found at ${relativePath}`
      : `File not found: ${relativePath}`
  );

  if (!v1ok) {
    return { passed, checks };
  }

  // V2: File is non-empty (at least 1 non-whitespace character)
  const content = fs.readFileSync(templatePath, 'utf8');
  const isNonEmpty = /\S/.test(content);
  const v2ok = addCheck(
    'V2',
    'File is non-empty',
    isNonEmpty,
    isNonEmpty
      ? `File has content (${content.length} bytes)`
      : 'File is empty or contains only whitespace'
  );

  if (!v2ok) {
    return { passed, checks };
  }

  // V3: At least one `## ` heading found
  const sections = parseSections(content);
  const hasHeadings = sections.length > 0;
  const sectionNames = sections.map((s) => s.name);
  const v3ok = addCheck(
    'V3',
    'At least one ## section found',
    hasHeadings,
    hasHeadings
      ? `Found ${sections.length} section${sections.length === 1 ? '' : 's'}: ${sectionNames.join(', ')}`
      : 'No ## headings found in file'
  );

  if (!v3ok) {
    return { passed, checks };
  }

  // V4: No duplicate heading names (case-insensitive)
  const nameCounts = {};
  for (const name of sectionNames) {
    const key = name.toLowerCase();
    nameCounts[key] = (nameCounts[key] || 0) + 1;
  }
  const duplicates = Object.entries(nameCounts)
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      // Find original casing for display
      const original = sectionNames.find((n) => n.toLowerCase() === key);
      return `'${original}' appears ${count} times`;
    });
  const noDuplicates = duplicates.length === 0;
  addCheck(
    'V4',
    'No duplicate section headings',
    noDuplicates,
    noDuplicates
      ? `All ${sections.length} section heading${sections.length === 1 ? ' is' : 's are'} unique`
      : `Duplicate: ${duplicates.join('; ')}`
  );

  // V5: Every section has body text of at least 20 characters
  const minBodyLength = 20;
  const shortSections = sections.filter((s) => s.body.length < minBodyLength);
  const allHaveBody = shortSections.length === 0;
  addCheck(
    'V5',
    `Every section has body text (>= ${minBodyLength} chars)`,
    allHaveBody,
    allHaveBody
      ? `All ${sections.length} section${sections.length === 1 ? ' has' : 's have'} sufficient body text`
      : shortSections
          .map((s) => `Section '${s.name}' has ${s.body.length} chars (min ${minBodyLength})`)
          .join('; ')
  );

  return { passed, checks, relativePath };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

/**
 * Format the validation result as JSON.
 *
 * @param {{ passed: boolean, checks: object[] }} result
 * @returns {string}
 */
function formatJson(result) {
  return JSON.stringify(result, null, 2);
}

/**
 * Format the validation result as a markdown table.
 *
 * @param {{ passed: boolean, checks: object[] }} result
 * @returns {string}
 */
function formatMarkdown(result, relativePath = '.sdlc/pr-template.md') {
  const lines = [];

  lines.push(`PR template validation: ${relativePath}`);
  lines.push('');
  lines.push('| Check | Description | Status | Detail |');
  lines.push('| ----- | ----------- | ------ | ------ |');

  for (const check of result.checks) {
    const statusCell = check.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    lines.push(`| ${check.id} | ${check.description} | ${statusCell} | ${check.detail} |`);
  }

  lines.push('');

  const failCount = result.checks.filter((c) => c.status === 'FAIL').length;
  if (result.passed) {
    lines.push('Result: ✅ All checks passed');
  } else {
    lines.push(`Result: ❌ ${failCount} check(s) failed`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Main entry point — parse args, run validation, write output, set exit code.
 */
function main() {
  const { projectRoot, outputFormat } = parseArgs(process.argv);
  const result = validatePrTemplate(projectRoot);

  if (outputFormat === 'json') {
    process.stdout.write(formatJson(result) + '\n');
  } else {
    process.stdout.write(formatMarkdown(result, result.relativePath) + '\n');
  }

  process.exit(result.passed ? 0 : 1);
}

main();

module.exports = { parseArgs, parseSections, validatePrTemplate, formatJson, formatMarkdown };
