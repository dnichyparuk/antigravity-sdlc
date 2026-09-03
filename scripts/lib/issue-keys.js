'use strict';

/**
/**
 * issue-keys.js
 * Single source for issue ticket extraction across the corpus (issue #284,
 * task 21). Replaces the bare `JIRA_PATTERN` in `skill/pr.js` and the
 * `TICKET_RE` inside `lib/version.js::parseConventionalCommit`.
 *
 * Canonical patterns:
 *   - Jira: \b([A-Z]{2,10}-\d+)\b
 *   - GitHub: #123, issue-123, 123-some-feature
 *
 * The pattern is intentionally a string (not a precompiled RegExp) so
 * each caller can wrap it with the flags they need (`g` for find-all,
 * none for first-match) without sharing mutable RegExp state.
 *
 * Exports:
 *   - ISSUE_KEY_REGEX_SOURCE   raw pattern string (no flags)
 *   - issueKeyRegex(flags)     fresh RegExp with the requested flags
 *   - extractKeys(text, opts) all unique keys in `text`, optional prefix filter
 *   - extractFromBranchAndCommits(branch, commits, opts)
 *                             ordered, deduplicated keys from branch + commits
 */

const ISSUE_KEY_REGEX_SOURCE = '\\b([A-Z]{2,10}-\\d+)\\b|(?:^|\\s)#(\\d+)\\b|\\bissue-(\\d+)\\b|\\b(\\d+)-[a-zA-Z0-9_-]+\\b';

/**
 * Build a fresh RegExp instance with the given flags. Returning a new
 * instance per call avoids cross-caller state on global-flag matchers.
 * @param {string} [flags='']
 * @returns {RegExp}
 */
function issueKeyRegex(flags = '') {
  return new RegExp(ISSUE_KEY_REGEX_SOURCE, flags);
}

/**
 * Extract all unique issue keys from a blob of text. Order preserved.
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.prefix]  Limit to keys whose prefix matches (e.g. `"PROJ"`).
 * @returns {string[]}
 */
function extractKeys(text, { prefix = null } = {}) {
  if (!text) return [];
  const re = issueKeyRegex('g');
  const all = [];
  for (const match of text.matchAll(re)) {
    // Extract the first non-undefined capture group
    const key = match[1] || match[2] || match[3] || match[4];
    if (key) {
      // Normalize GitHub issue numbers to just the number if they match #123 or issue-123
      all.push(match[1] ? key : `#${key}`);
    }
  }
  const filtered = prefix ? all.filter(id => id.startsWith(`${prefix}-`)) : all;
  return [...new Set(filtered)];
}

/**
 * Extract issue keys from a branch name and a list of commit subjects/bodies.
 * Branch name takes precedence (its key, if any, is first in the result).
 *
 * @param {string|null} branch
 * @param {Array<{subject?: string, body?: string}>} commits
 * @param {object} [opts]
 * @param {string} [opts.prefix]
 * @returns {string[]}  Unique keys, branch-first then commit order.
 */
function extractFromBranchAndCommits(branch, commits, opts = {}) {
  const seen = new Set();
  const out  = [];

  const push = (key) => {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  };

  if (branch) {
    for (const k of extractKeys(branch, opts)) push(k);
  }
  if (Array.isArray(commits)) {
    for (const c of commits) {
      const text = `${c?.subject || ''}\n${c?.body || ''}`;
      for (const k of extractKeys(text, opts)) push(k);
    }
  }
  return out;
}

module.exports = {
  ISSUE_KEY_REGEX_SOURCE,
  issueKeyRegex,
  extractKeys,
  extractFromBranchAndCommits,
};
