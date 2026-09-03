#!/usr/bin/env node
/**
 * plan-handoff-advisory.js
 * Thin wrapper around `lib/context-advisory.getAdvisory()` for plan-sdlc
 * Step 7. Exists as a dedicated script so the skill can invoke it via Bash
 * with a stable relative path — invoking via `node -e` would require the
 * skill to know the absolute lib path at every cwd it might run from.
 *
 * Behavior:
 *   - When the sidecar at $TMPDIR/sdlc-context-stats.json indicates
 *     `heavy: true`, prints the advisory text to stdout (suitable for
 *     prepending to the handoff menu).
 *   - When the sidecar is absent, malformed, or `heavy: false`, prints
 *     nothing.
 *   - Always exits 0. Any internal error is swallowed so plan-sdlc Step 7
 *     never blocks on this advisory.
 */

'use strict';

try {
  const { getAdvisory } = require('../lib/context-advisory');
  const { emitText } = require('../lib/output');
  const text = getAdvisory({ skill: 'plan-sdlc' });
  // emitText() calls process.exit(0) internally — control does not return
  // here on the success path. The catch below only fires for failures in
  // require() or getAdvisory() (i.e. before emitText is invoked).
  if (text) emitText(text);
} catch (_) {
  // Graceful degradation — silent failure, never break handoff.
}

process.exit(0);
