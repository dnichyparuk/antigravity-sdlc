'use strict';

/**
 * branch-name.js
 * Pure helper for config-driven branch-name derivation.
 * No I/O, no fs, no child_process — pure computation only.
 *
 * Zero npm dependencies — Node.js built-ins only.
 *
 * Mirrors lib/worktree-path.js shape.
 * Consumed by ship-sdlc pre-execute block and execute-plan-sdlc standalone Step 1.
 * Config driven by workspace.branch section in .sdlc/local.json.
 */

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATE       = '{type}/{slug}';
const DEFAULT_SLUG_MAX_LENGTH = 50;
const DEFAULT_TYPE_MAP = {
  feature:  'feat',
  bugfix:   'fix',
  chore:    'chore',
  docs:     'docs',
  refactor: 'refactor',
};

// Branch name charset: alphanumeric, /, -, _, .
// Any other character is replaced with '-'.
const INVALID_BRANCH_CHAR = /[^a-zA-Z0-9/\-_.]/g;

// Known placeholders
const KNOWN_PLACEHOLDERS = new Set(['{type}', '{slug}', '{issue}', '{date}']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute YYYYMMDD date string from a Date in local timezone.
 * @param {Date} d
 * @returns {string}
 */
function formatDate(d) {
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Validate that a template contains no unknown placeholders.
 * @param {string} template
 * @throws {TypeError} when an unknown placeholder is found.
 */
function validateTemplate(template) {
  const found = template.match(/\{[^}]+\}/g) || [];
  for (const placeholder of found) {
    if (!KNOWN_PLACEHOLDERS.has(placeholder)) {
      throw new TypeError(
        `Unknown placeholder '${placeholder}' in template '${template}'. ` +
        `Supported: ${[...KNOWN_PLACEHOLDERS].join(', ')}.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a git branch name from plan metadata and workspace.branch config.
 *
 * @param {object} opts
 * @param {string} opts.type     Logical type key (e.g. 'feature', 'bugfix', 'chore', 'docs', 'refactor').
 *                               Mapped through config.typeMap before substitution.
 * @param {string} opts.slug     Raw slug (lowercase-hyphenated). Truncated to config.slugMaxLength.
 * @param {string} [opts.issue]  Optional issue/ticket key (e.g. '#378', 'INT-123').
 *                               Used only when {issue} placeholder appears in template.
 * @param {Date}   [opts.now]    Current date (defaults to new Date()). Used for {date} placeholder.
 * @param {object} [opts.config] workspace.branch config object (all fields optional).
 * @param {string} [opts.config.template]       Branch name template. Default: "{type}/{slug}".
 * @param {number} [opts.config.slugMaxLength]  Max slug length before truncation. Default: 50. Min: 8 (matches schema).
 * @param {object} [opts.config.typeMap]        Mapping from logical type to branch prefix. Merged with defaults.
 *
 * @returns {string} Resolved branch name.
 * @throws {TypeError} On empty slug, unknown placeholder, or invalid resolved name.
 */
function resolveBranchName(opts) {
  const {
    type,
    slug,
    issue  = '',
    now    = new Date(),
    config = {},
  } = opts || {};

  // Validate required inputs
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new TypeError('slug must be a non-empty string');
  }

  // Resolve config with defaults
  const template      = (typeof config.template === 'string' && config.template) ? config.template : DEFAULT_TEMPLATE;
  const slugMaxLength = (typeof config.slugMaxLength === 'number' && config.slugMaxLength >= 8) ? config.slugMaxLength : DEFAULT_SLUG_MAX_LENGTH;
  const typeMap       = Object.assign({}, DEFAULT_TYPE_MAP, config.typeMap || {});

  // Validate template placeholders
  validateTemplate(template);

  // Map logical type to branch prefix
  const mappedType = (type && typeMap[type]) ? typeMap[type] : (type || 'chore');

  // Truncate slug to slugMaxLength
  const truncatedSlug = slug.slice(0, slugMaxLength);

  // Compute date
  const d       = now instanceof Date ? now : new Date();
  const dateStr = formatDate(d);

  // Substitute placeholders
  // {issue} substitutes empty string when issue is not provided
  const issueValue = issue ? String(issue).replace(/^#/, '') : '';

  let resolved = template
    .replace(/\{type\}/g,  mappedType)
    .replace(/\{slug\}/g,  truncatedSlug)
    .replace(/\{issue\}/g, issueValue)
    .replace(/\{date\}/g,  dateStr);

  // Sanitize: replace any character not in [a-zA-Z0-9/\-_.] with '-'
  resolved = resolved.replace(INVALID_BRANCH_CHAR, '-');

  // Collapse multiple consecutive dashes (but preserve /)
  resolved = resolved.replace(/-{2,}/g, '-');

  // Strip leading/trailing dashes from each segment
  resolved = resolved
    .split('/')
    .map(seg => seg.replace(/^-+|-+$/g, ''))
    .join('/');

  if (resolved === '' || resolved === '/') {
    throw new TypeError(`Branch name resolved to empty or invalid value from template '${template}'`);
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  resolveBranchName,
};
