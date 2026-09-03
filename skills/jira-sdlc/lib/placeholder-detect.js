'use strict';

/**
 * Detect unfilled placeholder markers in jira-sdlc payloads (R19 / C13).
 *
 * Two equally-treated placeholder forms:
 *   - Brace form: `{snake_or_kebab_name}`
 *   - Bracket form: `[bracketed prose >= 3 chars]`
 *
 * Walks every string-valued field of the payload, including nested ADF
 * `text` nodes (Atlassian Document Format), so that placeholders inside
 * description / commentBody / body fields are caught.
 *
 * When dispatched via `findPlaceholdersForToolInput` and the tool input
 * declares `contentFormat === 'adf'`, the comment body is routed through
 * `findPlaceholdersInAdf` which walks parsed ADF `text` nodes only — the
 * bracket-form regex never runs against the stringified ADF blob,
 * eliminating C13 false positives on JSON-serialized arrays.
 *
 * The bracket-form arm is additionally suppressed for the `summary` field
 * across all content formats — Jira `[CATEGORY]` title prefixes (e.g.
 * `[OIDC/SSO]`, `[IDS]`, `[FEAT]`) produce false positives; brace-form
 * detection on `summary` is retained (C13 carve-out, issue #365).
 */

// Global /g flag required for exec() looping. Callers MUST reset .lastIndex = 0 before each use.
const PLACEHOLDER_REGEX = /\{[a-zA-Z_][a-zA-Z0-9_-]*\}|\[(?![{"\d])[^\]\n]{3,}\]/g;
// Brace-form only — used to retain {name} detection on the summary field while suppressing bracket-form.
const BRACE_ONLY = /^\{[a-zA-Z_][a-zA-Z0-9_-]*\}$/;

/**
 * C13 summary carve-out: drop bracket-form findings on the `summary` field
 * while keeping brace-form findings. Applied unconditionally across every
 * dispatch return path in `findPlaceholdersForToolInput` so the rule holds
 * for markdown, default, and ADF content formats alike.
 *
 * @param {Array<{path: string, marker: string}>} results
 * @returns {Array<{path: string, marker: string}>}
 */
function filterSummaryBrackets(results) {
  return results.filter(r => r.path !== 'summary' || BRACE_ONLY.test(r.marker));
}

/**
 * @param {*} payload
 * @returns {Array<{path: string, marker: string}>}
 */
function findPlaceholders(payload) {
  const results = [];
  walk(payload, '', results);
  return results;
}

function walk(node, path, results) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    PLACEHOLDER_REGEX.lastIndex = 0;
    let m;
    while ((m = PLACEHOLDER_REGEX.exec(node)) !== null) {
      results.push({ path, marker: m[0] });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, path ? `${path}[${i}]` : `[${i}]`, results));
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      walk(node[k], path ? `${path}.${k}` : k, results);
    }
  }
}

/**
 * Walk a parsed ADF tree and apply PLACEHOLDER_REGEX only to `text` node
 * values. ADF nodes have shape `{type, content?, text?, marks?}` per the
 * Atlassian Document Format spec.
 *
 * @param {*} node       ADF node (root or descendant)
 * @param {string} path  Breadcrumb path for findings
 * @param {Array<{path: string, marker: string}>} results
 */
function findPlaceholdersInAdf(node, path, results) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => findPlaceholdersInAdf(item, `${path}[${i}]`, results));
    return;
  }
  if (typeof node !== 'object') return;

  if (typeof node.text === 'string') {
    PLACEHOLDER_REGEX.lastIndex = 0;
    let m;
    while ((m = PLACEHOLDER_REGEX.exec(node.text)) !== null) {
      results.push({ path: `${path}.text`, marker: m[0] });
    }
  }
  if (Array.isArray(node.content)) {
    findPlaceholdersInAdf(node.content, `${path}.content`, results);
  }
}

/**
 * Dispatch entry that respects `tool_input.contentFormat`. When
 * `contentFormat === 'adf'`, routes `commentBody` through the ADF walker
 * and walks every other field with the existing whole-payload walker.
 * For markdown / unset content formats, falls back to the original
 * `findPlaceholders` whole-payload string walk.
 *
 * @param {*} toolInput
 * @returns {{results: Array<{path: string, marker: string}>, warnings: string[]}}
 */
function findPlaceholdersForToolInput(toolInput) {
  const results = [];
  const warnings = [];
  if (toolInput === null || typeof toolInput !== 'object') {
    walk(toolInput, '', results);
    return { results: filterSummaryBrackets(results), warnings };
  }

  const contentFormat = toolInput.contentFormat;
  if (contentFormat !== 'adf') {
    walk(toolInput, '', results);
    return { results: filterSummaryBrackets(results), warnings };
  }

  // ADF dispatch: walk every field except `commentBody` with the default walker.
  for (const k of Object.keys(toolInput)) {
    if (k === 'commentBody') continue;
    walk(toolInput[k], k, results);
  }

  // Route commentBody through the ADF walker, parsing if stringified.
  const cb = toolInput.commentBody;
  if (cb === null || cb === undefined) return { results: filterSummaryBrackets(results), warnings };

  let adfRoot = cb;
  if (typeof cb === 'string') {
    try {
      adfRoot = JSON.parse(cb);
    } catch (err) {
      warnings.push(
        `commentBody declared contentFormat='adf' but JSON.parse failed: ${err.message}; falling back to whole-payload string walk.`
      );
      walk(cb, 'commentBody', results);
      return { results: filterSummaryBrackets(results), warnings };
    }
  }

  findPlaceholdersInAdf(adfRoot, 'commentBody', results);
  return { results: filterSummaryBrackets(results), warnings };
}

module.exports = {
  findPlaceholders,
  findPlaceholdersInAdf,
  findPlaceholdersForToolInput,
  PLACEHOLDER_REGEX,
};
