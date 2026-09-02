#!/usr/bin/env node
/**
 * validate-pr-title.js
 * Direct Node port of pr-sdlc/scripts/validate_title.sh — validates a PR
 * title against a regex pattern, printing a custom error message on
 * mismatch.
 *
 * Usage:
 *   node validate-pr-title.js <title> <pattern> <error-message>
 *
 * Exit codes:
 *   0 = title matches pattern
 *   1 = title does not match pattern (error-message, or the pattern itself
 *       if no error-message was given, is printed to stderr)
 *
 * Zero npm dependencies — Node.js built-ins only.
 */

'use strict';

/**
 * @param {string[]} argv  process.argv
 * @returns {{ title: string|undefined, pattern: string|undefined, errorMessage: string|undefined }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  return { title: args[0], pattern: args[1], errorMessage: args[2] };
}

/**
 * @param {string[]} argv  process.argv
 */
function main(argv) {
  const { title, pattern, errorMessage } = parseArgs(argv);
  const re = new RegExp(pattern);
  if (!re.test(title)) {
    console.error(errorMessage || pattern);
    process.exit(1);
    return;
  }
  process.exit(0);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { parseArgs, main };
