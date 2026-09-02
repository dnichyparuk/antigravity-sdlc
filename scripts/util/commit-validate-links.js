#!/usr/bin/env node
/**
 * commit-validate-links.js
 * Node port of commit-sdlc/scripts/validate_links.sh (issue #198, R12 —
 * link-verification hard gate consumed by commit-sdlc/SKILL.md Step 1).
 *
 * Usage:
 *   node commit-validate-links.js --file <path>
 *   echo "<commit body>" | node commit-validate-links.js
 *
 * Reads a commit message body from --file <path> or, when --file is not
 * given, from stdin, then validates every embedded URL via
 * scripts/lib/links.js's validateLinks(). ctx is intentionally left empty —
 * validateLinks() auto-derives expectedRepo (parseRemoteOwner(cwd)) and
 * jiraSite (~/.sdlc-cache/jira/ discovery) on its own, matching the
 * SKILL.md note that "the skill MUST NOT construct ctx JSON".
 *
 * Bugs found and fixed while porting the shell original (task-13):
 *
 *   1. `elif [ -n "$message" ]` referenced a `$message` shell variable that
 *      is never assigned anywhere in the script's own scope, never exported
 *      by any caller (commit-sdlc/SKILL.md invokes the script bare, with
 *      neither --file nor a $message env var), and is not documented as an
 *      env var anywhere in SKILL.md. It was dead/unreachable code — always
 *      falsy, so the branch never ran. Dropped rather than ported; the two
 *      live paths (--file, stdin) are kept, matching SKILL.md's documented
 *      Input contract ("Commit body via stdin, or via --file <path>
 *      argument").
 *   2. The shell script always passed `--json` to links.js, which prints
 *      the full JSON verdict to STDOUT — but SKILL.md's Output contract
 *      documents "Prints violations to stderr". The two disagreed.
 *   3. The shell script computed `LINK_EXIT=$?` but never `exit
 *      "$LINK_EXIT"` — a bare variable assignment always itself returns 0,
 *      so the script's actual exit status was always 0 regardless of link
 *      violations, silently defeating the "HARD GATE" described in
 *      SKILL.md Step 1.
 *
 * This port implements the SKILL.md-documented contract directly (stderr
 * violation report, real exit code) rather than reproducing bugs 2 and 3.
 *
 * Exit codes:
 *   0 = no violations
 *   1 = violations found (printed to stderr)
 *   2 = usage error / unreadable --file / unexpected crash
 *
 * Zero npm dependencies — Node.js built-ins only (links.js itself needs no
 * npm dependencies either).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateLinks, formatViolations } = require(path.join(__dirname, '..', 'lib', 'links.js'));

/**
 * @param {string[]} argv  process.argv
 * @returns {{ file: string|null }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let file = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--file' && args[i + 1] !== undefined) {
      file = args[++i];
    } else {
      process.stderr.write(`commit-validate-links.js: unknown parameter: ${a}\n`);
      process.exit(2);
    }
  }
  return { file };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

/**
 * @param {string[]} argv  process.argv
 */
async function main(argv) {
  const { file } = parseArgs(argv);

  let body;
  if (file) {
    try {
      body = fs.readFileSync(file, 'utf8');
    } catch (err) {
      process.stderr.write(`commit-validate-links.js: cannot read --file ${file}: ${err.message}\n`);
      process.exit(2);
      return;
    }
  } else {
    body = await readStdin();
  }

  const result = await validateLinks(body, {});
  if (!result.ok) {
    process.stderr.write(formatViolations(result.violations));
    process.stderr.write('\n');
    process.exit(1);
    return;
  }
  process.exit(0);
}

if (require.main === module) {
  main(process.argv).catch((err) => {
    process.stderr.write(`commit-validate-links.js error: ${(err && err.stack) || err}\n`);
    process.exit(2);
  });
}

module.exports = { parseArgs, main };
