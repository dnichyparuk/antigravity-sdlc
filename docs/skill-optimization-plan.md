# Lift-SDLC Skill Optimization Plan

## 1. Validation of Opportunities
After reviewing the consolidated optimization reports for all 14 `lift-sdlc` skills, the proposed reductions have been cross-checked and validated against the core architecture. 

**Validation Outcome:** 
- The opportunities are mathematically sound (projecting a ~40–60% reduction in token footprint across the plugin).
- **Zero Loss of Rigor**: None of the identified cuts remove architectural safety nets, quality gates, or core agent capabilities. The reductions exclusively target instructional bloat, repetitive defensive prompting, and shell orchestration logic that is safer handled in pure Node.js.

## 2. Identified Anti-Patterns
The cross-check surfaced four recurring structural anti-patterns responsible for the token bloat:

1. **The "Shell Orchestrator" Anti-Pattern**: 
   - *Issue*: Instructing the LLM to write multi-step, brittle bash sequences (e.g., handling `git rebase` failures in `ship-sdlc`, or atomic tag deletion in `version-sdlc`).
   - *Fix*: Encapsulate these sequences into headless Node.js helpers (`scripts/*.js`). **Do NOT use `.sh` Bash scripts.** Migrating this orchestration to Node.js ensures 100% native cross-platform compatibility across Windows and Linux, handles pathing (`/` vs `\`) flawlessly, and provides native JSON output parsing.
2. **The "Defensive Repetition" Anti-Pattern**:
   - *Issue*: Stating a rule in the "Quality Gates", and then repeating it identically in the "Best Practices", "DO NOT", and "Gotchas" lists (e.g., `pr-sdlc` template rules, `review-sdlc` output constraints).
   - *Fix*: Centralize constraints. State a rule once in the operational step and aggressively prune trailing Gotchas/DO NOTs.
3. **The "Developer Lore & Traceability" Anti-Pattern**:
   - *Issue*: Prompts contain internal issue numbers, requirement tags (`R1`, `Fixes #418`), and historical design rationales meant for human maintainers.
   - *Fix*: Strip all internal tracking metadata and architectural exposition from runtime prompts.
4. **The "JSON Schema & Data Mapping" Anti-Pattern**:
   - *Issue*: Forcing the LLM to memorize and apply complex data mappings (e.g., `jira-sdlc` field mappings, `pr-sdlc` branch-to-label mappings) that can be deterministically calculated.
   - *Fix*: Offload evaluation logic to the `prepare.js` setup layer, outputting the computed result directly to the LLM.

---

## 3. Implementation Plan (Phased Roadmap)

To safely refactor the plugin while maintaining stability and enforcing cross-platform compatibility, the optimizations will be executed in 4 distinct phases.

### Phase 1: Cross-Platform Node.js Offloading
*Target: Move multi-step shell logic into robust, cross-platform `*.js` scripts.*
- [ ] **`execute-plan-sdlc`**: Offload wave WIP commits and resume-detection logic into Node scripts (e.g., `check-resume.js` and `wave-commit.js`).
- [ ] **`ship-sdlc`**: Consolidate `git rebase` fallback, worktree cleanup, and OpenSpec archive git loops into dedicated Node helpers via `child_process.execSync`.
- [ ] **`commit-sdlc`**: Wrap `git reset --soft` and `stash` pop logic into a single `squash-wip.js` wrapper.
- [ ] **`version-sdlc`**: Create a deterministic `retag-helper.js` to handle atomic tag rollback/creation cross-platform.

### Phase 2: Schema & Data Mapping Delegation
*Target: Move evaluation tables into the JS setup layers.*
- [ ] **`pr-sdlc`**: Move branch-to-label deterministic mapping into `scripts/skill/pr.js`.
- [ ] **`harden-sdlc`**: Offload `--failure-text`/`--from-issue` argument exclusivity and issue fetching to `harden-prepare.js`.
- [ ] **`verify-pipeline-sdlc`**: Consolidate `gh` auth checks and log extraction branching into the JS layer.

### Phase 3: Defensive Repetition Pruning
*Target: Delete duplicate constraints from trailing lists.*
- [ ] **Global**: Review all 14 `SKILL.md` files. Identify constraints listed in the main execution steps.
- [ ] **Global**: Delete redundant matching items from `Gotchas`, `DO NOT`, and `Best Practices` sections.
- [ ] **`jira-sdlc`**: Consolidate MCP failure telemetry blocks into a single reference section.

### Phase 4: Developer Lore Eradication
*Target: Strip human-targeted background context.*
- [ ] **Global**: Search and destroy all requirement tags (e.g. `R1`, `C5`), GitHub issue cross-references (`Fixes #123`), and design rationales (e.g. "Why config.changelog, not flags.changelog").
- [ ] **`plan-sdlc` & `ship-sdlc`**: Remove multi-paragraph explanations of background engine hook lifecycles.


### Phase 5: Legacy Script Modernization & Test Coverage
*Target: Migrate all existing .sh wrapper scripts to pure Node.js (.js) and mandate test coverage.*
- [ ] **Global Script Conversion**: Audit all skills/*/scripts/*.sh files (e.g., workspace_setup.sh, prepare.sh) and rewrite them as pure Node.js scripts.
- [ ] **Eliminate Sub-process Hacks**: Replace brittle Bash-isms like inline 
ode -e eval hacks, Unix-specific pipes (/dev/null), and text tools (sed) with native Node.js equire() imports, string manipulation, and cross-platform child_process methods.
- [ ] **Direct Invocation**: Update all SKILL.md files to invoke 
ode <script>.js instead of the legacy bash wrappers, eliminating the Bash middleman entirely.
- [ ] **Test Coverage Mandate**: Ensure all newly written and migrated Node.js scripts are fully backed by unit/integration tests to guarantee deterministic git interactions, JSON parsing reliability, and flawless cross-platform execution (Windows/Linux).
