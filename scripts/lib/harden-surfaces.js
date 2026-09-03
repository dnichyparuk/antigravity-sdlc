/**
 * harden-surfaces.js
 *
 * Per-surface loaders for harden-prepare.js. Extracted from the prepare script
 * to honor docs/specs/harden-sdlc.md C2 (≤200 lines for prepare). Each loader
 * is deterministic and tolerates missing files (R4 + E2 — empty arrays, not
 * crashes; parse errors recorded into the shared `errors[]` array).
 *
 * Zero external deps — Node.js built-ins only, plus existing lib/ helpers.
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const { readSection } = require('./config');
const { extractFrontmatter, parseSimpleYaml } = require('./dimensions');

// ---------------------------------------------------------------------------
// Private helper: resolve a sibling script via in-repo fast path, then peer fallback
// ---------------------------------------------------------------------------

/**
 * @param {string} callerDirname  — __dirname of the calling module
 * @param {string[]} segments     — path segments relative to plugin root (e.g. ['skills','error-report-sdlc','REFERENCE.md'])
 * @param {object[]} errors       — shared errors array; receives {surface, message} on failure
 * @param {string} surfaceLabel   — label used in error entry
 * @returns {string} absolute resolved path, or '' on failure
 */
function resolveSibling(callerDirname, segments, errors, surfaceLabel) {
  // Resolve sibling path: callerDirname is lib/, so ../../ reaches the plugin root.
  // segments are relative to the plugin root (e.g. ['skills', 'error-report-sdlc', 'REFERENCE.md']).
  const resolved = path.join(callerDirname, '..', '..', ...segments);
  if (fs.existsSync(resolved)) return path.resolve(resolved);
  errors.push({ surface: surfaceLabel, message: `${segments.join('/')} not found at ${resolved}` });
  return '';
}

// ---------------------------------------------------------------------------
// Plan / Execute guardrails — sourced from .sdlc/config.json (issue #231; legacy .sdlc/sdlc.json read via lib/config.js fallback)
// ---------------------------------------------------------------------------

/**
 * Load guardrails for the given section ('plan' or 'execute').
 * Replaces the old loadPlanGuardrails / loadExecuteGuardrails pair (R15 DRY).
 *
 * @param {string} projectRoot
 * @param {string} sectionName — 'plan' | 'execute'
 * @param {object[]} errors
 * @returns {{id: string, severity: string, description: string}[]}
 */
function loadGuardrails(projectRoot, sectionName, errors) {
  let section;
  try {
    section = readSection(projectRoot, sectionName);
  } catch (err) {
    errors.push({ surface: `${sectionName}-guardrails`, message: `readSection failed: ${err.message}` });
    return [];
  }
  const list = section?.guardrails;
  if (!Array.isArray(list)) return [];
  return list.map(g => ({
    id:          typeof g.id === 'string' ? g.id : '',
    severity:    typeof g.severity === 'string' ? g.severity : 'error',
    description: typeof g.description === 'string' ? g.description : '',
  }));
}

// ---------------------------------------------------------------------------
// Duplication detection helper (R15)
// ---------------------------------------------------------------------------

/**
 * Detect id or description overlap between an existing guardrails array and a proposed guardrail.
 *
 * @param {{id: string, description: string}[]} existing
 * @param {{id: string, description: string}} proposed
 * @returns {{ kind: 'id' | 'description' | null, existingIndex: number }}
 */
function findDuplicateGuardrails(existing, proposed) {
  // 1. Exact id match
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].id && existing[i].id === proposed.id) {
      return { kind: 'id', existingIndex: i };
    }
  }

  // 2. Description overlap heuristic:
  //    shared 5+ char run AND ≥40% Jaccard on whitespace-split tokens (length > 3)
  const propTokens = new Set(
    String(proposed.description || '').toLowerCase().split(/\s+/).filter(t => t.length > 3)
  );
  for (let i = 0; i < existing.length; i++) {
    const exTokens = new Set(
      String(existing[i].description || '').toLowerCase().split(/\s+/).filter(t => t.length > 3)
    );
    if (propTokens.size === 0 || exTokens.size === 0) continue;
    const intersection = [...propTokens].filter(t => exTokens.has(t)).length;
    const union = new Set([...propTokens, ...exTokens]).size;
    if (union > 0 && intersection / union >= 0.4) {
      return { kind: 'description', existingIndex: i };
    }
  }

  return { kind: null, existingIndex: -1 };
}

// ---------------------------------------------------------------------------
// Review dimensions — .sdlc/review-dimensions/*.md frontmatter (issue #231;
// legacy .sdlc/review-dimensions/ supported via dimensions.js fallback).
// ---------------------------------------------------------------------------

function loadReviewDimensions(projectRoot, errors) {
  // Issue #231: prefer .sdlc/review-dimensions/, fall back to legacy via dimensions.js helper.
  const { resolveDimensionsDir } = require('./dimensions.js');
  const dir = resolveDimensionsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch (err) {
    errors.push({ surface: 'review-dimensions', message: `readdir failed: ${err.message}` });
    return [];
  }

  const out = [];
  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fmRaw = extractFrontmatter(content);
      if (!fmRaw) {
        errors.push({ surface: 'review-dimensions', message: `Missing frontmatter: ${f}` });
        continue;
      }
      const fm = parseSimpleYaml(fmRaw);
      out.push({
        name:        typeof fm.name === 'string' ? fm.name : '',
        severity:    typeof fm.severity === 'string' ? fm.severity : '',
        description: typeof fm.description === 'string' ? fm.description : '',
        triggers:    Array.isArray(fm.triggers) ? fm.triggers : [],
        model:       typeof fm.model === 'string' ? fm.model : '',
        path:        filePath,
      });
    } catch (err) {
      errors.push({ surface: 'review-dimensions', message: `Read/parse failed for ${f}: ${err.message}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Copilot instructions — .github/instructions/*.instructions.md
// ---------------------------------------------------------------------------

function loadCopilotInstructions(projectRoot, errors) {
  const dir = path.join(projectRoot, '.github', 'instructions');
  if (!fs.existsSync(dir)) return [];
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.instructions.md'));
  } catch (err) {
    errors.push({ surface: 'copilot-instructions', message: `readdir failed: ${err.message}` });
    return [];
  }

  const out = [];
  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fmRaw = extractFrontmatter(content);
      const fm = fmRaw ? parseSimpleYaml(fmRaw) : {};
      out.push({
        applyTo: typeof fm.applyTo === 'string' ? fm.applyTo : '',
        name:    f.replace(/\.instructions\.md$/, ''),
        path:    filePath,
      });
    } catch (err) {
      errors.push({ surface: 'copilot-instructions', message: `Read failed for ${f}: ${err.message}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sibling skill resolution — error-report-sdlc REFERENCE.md
// ---------------------------------------------------------------------------

function resolveErrorReportSkill(projectRoot, errors) {
  return resolveSibling(
    __dirname,
    ['skills', 'error-report-sdlc', 'REFERENCE.md'],
    errors,
    'error-report-skill'
  );
}

module.exports = {
  loadGuardrails,
  findDuplicateGuardrails,
  loadReviewDimensions,
  loadCopilotInstructions,
  resolveErrorReportSkill,
};
