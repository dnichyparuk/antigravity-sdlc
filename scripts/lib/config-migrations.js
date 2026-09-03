'use strict';

// ---------------------------------------------------------------------------
// config-migrations.js — canonical preset/step mappings.
//
// The migration registry (PROJECT_MIGRATIONS, LOCAL_MIGRATIONS) and all
// step functions have been removed. Legacy migration support was dropped
// because the fork is not expected to be used with old platform configs.
// Only the runtime preset-to-steps map and ALL_STEPS list are kept here;
// they are consumed by lib/config.js (PRESET_TO_STEPS re-export) and
// scripts/skill/ship-fields.js.
// ---------------------------------------------------------------------------

const PRESET_TO_STEPS = {
  full:     ['execute', 'commit', 'review', 'version', 'archive-openspec', 'pr', 'learnings-commit'],
  balanced: ['execute', 'commit', 'review',            'archive-openspec', 'pr', 'learnings-commit'],
  minimal:  ['execute', 'commit',                                          'pr', 'learnings-commit'],
};

const ALL_STEPS = ['execute', 'commit', 'review', 'version', 'archive-openspec', 'pr', 'learnings-commit'];

module.exports = { PRESET_TO_STEPS, ALL_STEPS };