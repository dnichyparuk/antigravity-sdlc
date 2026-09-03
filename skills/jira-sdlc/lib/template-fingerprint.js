'use strict';

/**
 * Resolve and fingerprint description templates for R18 enforcement.
 *
 * Resolution order:
 *   1. Override:  <projectRoot>/.sdlc/jira-templates/<IssueType>.md
 *   2. Shipped:   <pluginRoot>/skills/jira-sdlc/templates/<IssueType>.md
 *
 * The fingerprint is the set of `## ` heading texts. For the hook to allow
 * dispatch, every `## ` heading appearing in the payload description must be
 * a member of the resolved template's heading set (sections may be removed
 * but never invented).
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract `## ` headings from a markdown source.
 * @param {string} markdown
 * @returns {Set<string>}
 */
function extractHeadings(markdown) {
  const headings = new Set();
  if (typeof markdown !== 'string' || markdown.length === 0) return headings;
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) headings.add(m[1].trim());
  }
  return headings;
}

/**
 * Resolve the template for the given issue type and return its heading set.
 *
 * @param {string} issueType
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {string} [opts.shippedTemplatesDir] override for the shipped templates root
 * @returns {{ headings: Set<string>, source: 'override'|'shipped'|null, file: string|null }}
 */
function loadTemplateHeadings(issueType, projectRoot, opts = {}) {
  if (!issueType || typeof issueType !== 'string') {
    return { headings: new Set(), source: null, file: null };
  }
  const overrideFile = path.join(projectRoot, '.sdlc', 'jira-templates', `${issueType}.md`);
  if (fs.existsSync(overrideFile)) {
    const md = fs.readFileSync(overrideFile, 'utf8');
    return { headings: extractHeadings(md), source: 'override', file: overrideFile };
  }
  const shippedDir = opts.shippedTemplatesDir
    || path.resolve(__dirname, '..', 'templates');
  const shippedFile = path.join(shippedDir, `${issueType}.md`);
  if (fs.existsSync(shippedFile)) {
    const md = fs.readFileSync(shippedFile, 'utf8');
    return { headings: extractHeadings(md), source: 'shipped', file: shippedFile };
  }
  return { headings: new Set(), source: null, file: null };
}

module.exports = { extractHeadings, loadTemplateHeadings };
