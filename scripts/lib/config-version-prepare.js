'use strict';

// ---------------------------------------------------------------------------
// config-version-prepare.js — shared helper for skill prepare scripts.
//
// Single responsibility: resolve the skip-config-check gate and (when not
// skipped) call verifyAndMigrate for both project + local roles. Returns a
// uniform shape that prepare scripts splice into their output.
//
// Shape:
//   {
//     flags: { skipConfigCheck: boolean },
//     migration: { project: {...}, local: {...} } | null,
//     errors: [{ role, step, code, message }, ...]
//   }
//
// Implements the uniform contract in issues #231/#232. Used by every
// configurable skill's prepare script (commit, version, review, pr, plan,
// jira, harden-prepare, received-review, ship). NOT used by
// error-report-prepare.js (failure-path: must not gate on migration).
// ---------------------------------------------------------------------------

const { verifyAndMigrate } = require('./config-version.js');
const { ensureSdlcInfrastructure } = require('./config.js');

/**
 * Resolve the skip-config-check flag from CLI args + env. CLI > env > default false.
 *
 * @param {string[]} argv — process.argv
 * @returns {boolean}
 */
function resolveSkipConfigCheck(argv) {
  if (Array.isArray(argv) && argv.includes('--skip-config-check')) return true;
  if (process.env.SDLC_SKIP_CONFIG_CHECK === '1') return true;
  return false;
}

/**
 * Run verifyAndMigrate for both roles unless skip is set. Returns a manifest
 * suitable for splicing into a prepare script's JSON output.
 *
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {boolean} [opts.skip] — skip the calls; manifest reports null/skipped
 * @param {string[]} [opts.roles] — roles to migrate (default: ['project', 'local'])
 * @returns {{ flags: {skipConfigCheck: boolean}, migration: object|null, errors: object[] }}
 */
function ensureConfigVersion(projectRoot, opts = {}) {
  const skip = Boolean(opts.skip);
  const roles = opts.roles || ['project', 'local'];

  const out = {
    flags: { skipConfigCheck: skip },
    migration: null,
    errors: [],
  };

  if (!skip) {
    const migration = {};
    for (const role of roles) {
      try {
        migration[role] = verifyAndMigrate(projectRoot, role);
      } catch (err) {
        out.errors.push({
          role,
          step: err.step || null,
          code: err.code || 'UNKNOWN',
          message: err.message,
        });
      }
    }
    out.migration = migration;
  }

  // Infrastructure reconciliation runs regardless of skip flag.
  try {
    out.infrastructure = ensureSdlcInfrastructure(projectRoot);
  } catch (err) {
    out.errors.push({
      role: 'infrastructure',
      step: 'ensureSdlcInfrastructure',
      code: 'INFRA_FAILED',
      message: err.message,
    });
  }

  return out;
}

module.exports = {
  resolveSkipConfigCheck,
  ensureConfigVersion,
};
