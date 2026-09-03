#!/usr/bin/env node
/**
 * @file ci/validate-guardrails.js
 * @description Validates guardrail definitions in .sdlc/config.json (issue #231;
 *   legacy .sdlc/sdlc.json read via lib/config.js fallback): checks schema
 *   compliance, id uniqueness, severity values, and description quality.
 * @exit 0 all checks pass, 1 validation issues found
 */
'use strict';

const fs = require('fs');
const path = require('path');
const LIB = path.join(__dirname, '..', 'lib');

const { resolveSdlcRoot } = require(path.join(LIB, 'config'));
const { GUARDRAIL_SEVERITIES } = require(path.join(LIB, 'dimensions'));

/**
 * Parse command-line flags
 */
function parseArgs(args) {
  const result = {
    // C-projectroot (#360): default to main-worktree .sdlc/ root, not cwd.
    projectRoot: resolveSdlcRoot(),
    json: false,
    section: 'plan',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project-root' && i + 1 < args.length) {
      result.projectRoot = args[i + 1];
      i++;
    } else if (args[i] === '--json') {
      result.json = true;
    } else if (args[i] === '--section' && i + 1 < args.length) {
      result.section = args[i + 1];
      i++;
    }
  }
  return result;
}

/**
 * Import readSection from lib/config.js
 */
function loadReadSection() {
  const configPath = path.join(LIB, 'config.js');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Could not find lib/config.js at ${configPath}`);
  }

  const config = require(configPath);
  if (typeof config.readSection !== 'function') {
    throw new Error('readSection not exported from lib/config.js');
  }

  return config.readSection;
}

/**
 * Validate a single guardrail
 * @returns {object} { id, status, errors, warnings }
 */
function validateGuardrail(guardrail, seenIds) {
  const errors = [];
  const warnings = [];
  const result = {
    id: guardrail.id || '(missing)',
    status: 'PASS',
    errors,
    warnings,
  };

  // Validate id exists and is string
  if (!guardrail.id) {
    errors.push('id is missing');
    result.status = 'FAIL';
  } else if (typeof guardrail.id !== 'string') {
    errors.push('id must be a string');
    result.status = 'FAIL';
  } else {
    // Validate kebab-case pattern
    const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
    if (!kebabPattern.test(guardrail.id)) {
      errors.push(`id must match kebab-case pattern: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`);
      result.status = 'FAIL';
    }

    // Validate no duplicate IDs
    if (seenIds.has(guardrail.id)) {
      errors.push(`id is duplicated across guardrails`);
      result.status = 'FAIL';
    } else {
      seenIds.add(guardrail.id);
    }
  }

  // Validate description exists and is non-empty string
  if (!guardrail.description) {
    errors.push('description is missing');
    result.status = 'FAIL';
  } else if (typeof guardrail.description !== 'string') {
    errors.push('description must be a string');
    result.status = 'FAIL';
  } else if (guardrail.description.trim() === '') {
    errors.push('description cannot be empty');
    result.status = 'FAIL';
  }

  // Validate description length <= 512
  if (guardrail.description && guardrail.description.length > 512) {
    errors.push(`description exceeds 512 characters (${guardrail.description.length} chars)`);
    result.status = 'FAIL';
  }

  // Validate severity is valid (optional, defaults to error) — R17: use GUARDRAIL_SEVERITIES as source of truth
  if (guardrail.severity !== undefined && guardrail.severity !== null) {
    if (!GUARDRAIL_SEVERITIES.has(guardrail.severity)) {
      errors.push(`severity must be ${[...GUARDRAIL_SEVERITIES].map(s => `"${s}"`).join(', ')}, or undefined (got "${guardrail.severity}")`);
      result.status = 'FAIL';
    }
  }

  return result;
}

/**
 * Validate guardrail config for a given section — no process.exit, no console output.
 * Exported for programmatic use by harden-prepare.js (R16).
 *
 * @param {string} projectRoot — absolute path to the project root
 * @param {string} sectionName — 'plan' | 'execute' (or any readSection key)
 * @returns {{ errors: string[], warnings: string[], guardrailCount: number }}
 */
function validateGuardrailsConfig(projectRoot, sectionName) {
  const errors = [];
  const warnings = [];

  let readSection;
  try {
    readSection = loadReadSection(projectRoot);
  } catch (err) {
    errors.push(`Cannot load readSection: ${err.message}`);
    return { errors, warnings, guardrailCount: 0 };
  }

  const section = sectionName || 'plan';
  let sectionData;
  try {
    sectionData = readSection(projectRoot, section);
  } catch (err) {
    errors.push(`Cannot read section "${section}": ${err.message}`);
    return { errors, warnings, guardrailCount: 0 };
  }

  if (!sectionData || !Array.isArray(sectionData.guardrails)) {
    return { errors, warnings, guardrailCount: 0 };
  }

  const guardrails = sectionData.guardrails;
  const seenIds = new Set();

  for (const guardrail of guardrails) {
    const validation = validateGuardrail(guardrail, seenIds);
    for (const err of validation.errors) {
      errors.push(`${validation.id}: ${err}`);
    }
    for (const warn of validation.warnings) {
      warnings.push(`${validation.id}: ${warn}`);
    }
  }

  return { errors, warnings, guardrailCount: guardrails.length };
}

/**
 * Main validation logic — thin CLI wrapper around validateGuardrailsConfig.
 */
function main() {
  const args = process.argv.slice(2);
  const flags = parseArgs(args);

  try {
    const section = flags.section || 'plan';
    const result = validateGuardrailsConfig(flags.projectRoot, section);

    // If no guardrails configured, treat as pass
    if (result.guardrailCount === 0 && result.errors.length === 0) {
      const output = {
        overall: 'pass',
        summary: { total: 0, pass: 0, errors: 0, warnings: 0 },
        guardrails: [],
      };
      if (flags.json) {
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      } else {
        process.stdout.write(`No ${section} guardrails configured.\n`);
      }
      process.exit(0);
    }

    // Re-run per-guardrail validation for structured output (needed for CLI display)
    const readSection = loadReadSection(flags.projectRoot);
    const sectionData = readSection(flags.projectRoot, section);
    const guardrails = sectionData ? (sectionData.guardrails || []) : [];
    const seenIds = new Set();
    const results = [];

    let totalPass = 0;
    let totalFail = 0;
    let totalWarnings = 0;

    for (const guardrail of guardrails) {
      const validation = validateGuardrail(guardrail, seenIds);
      results.push(validation);

      if (validation.status === 'PASS') {
        totalPass++;
      } else {
        totalFail++;
      }
      totalWarnings += validation.warnings.length;
    }

    const overall = totalFail === 0 ? 'pass' : 'fail';
    const output = {
      overall,
      summary: {
        total: guardrails.length,
        pass: totalPass,
        errors: totalFail,
        warnings: totalWarnings,
      },
      guardrails: results,
    };

    if (flags.json) {
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    } else {
      process.stdout.write(`Guardrails: ${totalPass}/${guardrails.length} passed\n`);
      for (const result of results) {
        const statusStr = result.status === 'PASS' ? '✓' : '✗';
        process.stdout.write(`  ${statusStr} ${result.id}\n`);
        for (const err of result.errors) {
          process.stdout.write(`    ERROR: ${err}\n`);
        }
        for (const warn of result.warnings) {
          process.stdout.write(`    WARNING: ${warn}\n`);
        }
      }
    }

    process.exit(overall === 'pass' ? 0 : 1);
  } catch (err) {
    process.stderr.write('CRASH: ' + err.message + '\n');
    process.exit(2);
  }
}

module.exports = { validateGuardrailsConfig };

if (require.main === module) {
  main();
}
