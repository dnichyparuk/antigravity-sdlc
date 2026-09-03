'use strict';

/**
 * context-advisory.js
 * Reads the transcript-stats sidecar written by the UserPromptSubmit hook
 * (`hooks/context-stats.js`) and returns advisory text for SDLC handoff
 * boundaries (plan-sdlc Step 7, ship-sdlc Step 1c, execute-plan-sdlc Step 1).
 *
 * Sidecar location: `$TMPDIR/sdlc-context-stats.json` (falls back to
 * `os.tmpdir()` when `TMPDIR` is unset).
 *
 * Sidecar shape (written by hooks/context-stats.js):
 *   {
 *     ts:              ISO-8601 string,
 *     transcriptBytes: number,
 *     tokensApprox:    number,
 *     modelBudget:     number,
 *     percent:         number,
 *     heavy:           boolean
 *   }
 *
 * Returns:
 *   - null  when the sidecar is missing, unreadable, malformed, or `heavy === false`
 *   - string advisory text when `heavy === true`
 *
 * Zero npm dependencies — Node.js built-ins only.
 */

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const SIDECAR_NAME = 'sdlc-context-stats.json';

function sidecarPath() {
  const tmpDir = process.env.TMPDIR || os.tmpdir();
  return path.join(tmpDir, SIDECAR_NAME);
}

function readSidecar() {
  try {
    const raw = fs.readFileSync(sidecarPath(), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function formatTokens(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '~?k tokens';
  if (n < 1000) return `~${n} tokens`;
  const k = Math.round(n / 1000);
  return `~${k}k tokens`;
}

/**
 * Build a context-heaviness advisory for the given skill name.
 *
 * @param {object}  opts
 * @param {string} opts.skill  Skill identifier without leading slash
 *                             (e.g. `"plan-sdlc"`, `"ship-sdlc"`,
 *                             `"execute-plan-sdlc"`).
 * @returns {string|null}      Advisory text when transcript is heavy;
 *                             null otherwise.
 */
function getAdvisory(opts) {
  const skill = opts && typeof opts.skill === 'string' ? opts.skill : '';
  const data = readSidecar();
  if (!data) return null;
  if (data.heavy !== true) return null;

  const percent = typeof data.percent === 'number' ? data.percent : 0;
  const tokens  = formatTokens(data.tokensApprox);
  const slashed = skill ? `/${skill}` : '/<skill>';

  return [
    '─────────────────────────────────────────────',
    `Context advisory: transcript at ${percent}% of model budget (${tokens}).`,
    'Recommendation: run `/compact` before starting this pipeline.',
    'Pipeline state is preserved across `/compact` (PreCompact + SessionStart hooks),',
    `so re-invoke \`${slashed}\` afterwards to continue.`,
    '─────────────────────────────────────────────',
  ].join('\n');
}

module.exports = { getAdvisory };
