/**
 * yaml.js
 * Shared YAML frontmatter parser — single source for the lightweight
 * (no-external-deps) parser used by `lib/dimensions.js`, `lib/discovery.js`,
 * and the CI validators.
 *
 * Parsing scope is intentionally narrow: keys, string/boolean/integer values,
 * inline arrays (`[a, b]`), and multiline arrays (`-` items). It does NOT
 * support nested mappings, flow scalars, anchors, or quoted multi-line
 * blocks. If a richer parser is ever needed, prefer adding a separate module
 * over expanding this one — these consumers depend on its current limits
 * being predictable.
 *
 * Exports: extractFrontmatter, extractBody, parseSimpleYaml
 */

'use strict';

/**
 * Extract raw frontmatter string from file content.
 * Returns null if no valid frontmatter block found.
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/**
 * Extract body content (everything after the closing ---).
 */
function extractBody(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1].trim() : '';
}

/**
 * Parse a simple YAML string into an object.
 * Handles: strings, booleans, integers, inline arrays, multiline arrays.
 */
function parseSimpleYaml(yamlStr) {
  const result = {};
  const lines = yamlStr.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Skip empty lines
    if (!line.trim()) { i++; continue; }

    // Match key: value
    const kvMatch = line.match(/^(\S[^:]*?)\s*:\s*(.*)$/);
    if (!kvMatch) { i++; continue; }

    const key = kvMatch[1].trim();
    const rest = kvMatch[2].trim();

    if (rest === '') {
      // Multiline array — collect subsequent lines starting with '- '
      const arr = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s+-\s+/)) {
        arr.push(lines[i].replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, ''));
        i++;
      }
      result[key] = arr;
      continue;
    }

    // Inline array: [val1, val2]
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1);
      result[key] = inner.split(',').map(v => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      i++;
      continue;
    }

    // Boolean
    if (rest === 'true') { result[key] = true; i++; continue; }
    if (rest === 'false') { result[key] = false; i++; continue; }

    // Integer
    if (/^\d+$/.test(rest)) { result[key] = parseInt(rest, 10); i++; continue; }

    // String (strip optional quotes)
    result[key] = rest.replace(/^["']|["']$/g, '');
    i++;
  }

  return result;
}

module.exports = { extractFrontmatter, extractBody, parseSimpleYaml };
