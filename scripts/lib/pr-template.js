'use strict';
/**
 * pr-template.js
 *
 * Single resolution site for the PR template path (issue #260).
 * Mirrors the canonical-with-fallback shape of `lib/dimensions.js::resolveDimensionsDir`:
 *   - Canonical:          <project>/.sdlc/pr-template.md
 *   - Deprecated fallback: <project>/.sdlc/pr-template.md  (one-time stderr warning per process)
 *
 * Implements R-pr-template-path (pr-sdlc spec).
 *
 * Exports:
 *   resolvePrTemplatePath(projectRoot) -> absolute path or null
 *   loadPrTemplate(projectRoot)        -> string content or null
 */

const fs = require('node:fs');
const path = require('node:path');

let _legacyPrTemplateWarningEmitted = false;

/**
 * Resolve the PR template path. Returns the absolute path to the template,
 * or null if neither the canonical nor the deprecated location exists.
 * Emits a one-time stderr deprecation warning per process when only the
 * deprecated path is found.
 *
 * @param {string} projectRoot
 * @returns {string|null}
 */
function resolvePrTemplatePath(projectRoot) {
  const canonical = path.join(projectRoot, '.sdlc', 'pr-template.md');
  const legacy    = path.join(projectRoot, '.sdlc', 'pr-template.md');

  if (fs.existsSync(canonical)) return canonical;

  if (fs.existsSync(legacy)) {
    if (!_legacyPrTemplateWarningEmitted) {
      _legacyPrTemplateWarningEmitted = true;
      process.stderr.write(
        `Deprecation: ${path.join('.sdlc', 'pr-template.md')} is the legacy PR template location. ` +
        `Move it to ${path.join('.sdlc', 'pr-template.md')} (or run /setup-sdlc --pr-template).\n`
      );
    }
    return legacy;
  }

  return null;
}

/**
 * Load the PR template content. Returns the file contents as a UTF-8 string,
 * or null if no template exists.
 *
 * @param {string} projectRoot
 * @returns {string|null}
 */
function loadPrTemplate(projectRoot) {
  const filePath = resolvePrTemplatePath(projectRoot);
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

module.exports = {
  resolvePrTemplatePath,
  loadPrTemplate,
};
