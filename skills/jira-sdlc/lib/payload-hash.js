'use strict';

/**
 * Stable canonical JSON serialization + sha256 hashing for jira-sdlc payloads.
 *
 * Both the skill (when writing approval/critique artifacts) and the PreToolUse
 * hook (when verifying them) MUST use this module to compute the payload hash
 * so the two sides agree byte-for-byte regardless of property insertion order.
 *
 * Implements R21 of docs/specs/jira-sdlc.md.
 */

const crypto = require('crypto');

/**
 * Recursively canonicalize a value into a structure where every plain-object
 * key set is sorted lexicographically. Arrays preserve their order. Primitives
 * pass through. Functions, undefined, and null values are dropped recursively
 * so that MCP-harness defaulting (e.g., schema-default `commentVisibility: null`
 * injection) cannot desync skill-side and hook-side hashes.
 *
 * @param {*} value
 * @returns {*}
 */
function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object') return value;

  const sortedKeys = Object.keys(value).sort();
  const out = {};
  for (const k of sortedKeys) {
    const v = canonicalize(value[k]);
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Compute the canonical sha256 hash of a payload as a lowercase hex string.
 *
 * @param {*} payload
 * @returns {string} 64-char hex digest
 */
function payloadHash(payload) {
  const canonical = canonicalize(payload);
  const json = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

module.exports = { canonicalize, payloadHash };
