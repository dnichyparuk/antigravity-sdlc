mcp-failure[{CLASS}]: {TOOL} on {SITE}

## Classification
- **Class**: `{CLASS}`
- **R-path**: {R_PATH}

## Observed failure
- **Tool**: `{TOOL}`
- **Site**: {SITE}
- **Project**: {PROJECT}
- **Error**: {ERROR}

## Prior occurrences
- **Count (this session)**: {PRIOR_COUNT} prior occurrence(s) in `.sdlc/learnings/log.md`
- **Duplicate issue**: {DUPLICATE_HINT}

## Root-cause hypothesis
{CLASS}-class failure on `{TOOL}`: see classification rules in `scripts/lib/mcp-failure.js`.

## Relevant references
- SKILL.md callsite: search for `{R_PATH}` in `skills/jira-sdlc/SKILL.md`
- Spec requirement: see `R26`/`R28` in `docs/specs/jira-sdlc.md`
