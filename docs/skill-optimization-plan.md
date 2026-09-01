# Lift-SDLC Skill Optimization Plan

## 1. Validation of Opportunities
After reviewing the consolidated optimization reports for all 14 `lift-sdlc` skills, the proposed reductions have been cross-checked and validated against the core architecture. 

**Validation Outcome:** 
- The opportunities are mathematically sound (projecting a ~40–60% reduction in token footprint across the plugin).
- **Zero Loss of Rigor**: None of the identified cuts remove architectural safety nets, quality gates, or core agent capabilities. The reductions exclusively target instructional bloat, repetitive defensive prompting, and shell orchestration logic that is safer handled in Node/Bash.

## 2. Identified Anti-Patterns
The cross-check surfaced four recurring structural anti-patterns responsible for the token bloat:

1. **The "Shell Orchestrator" Anti-Pattern**: 
   - *Issue*: Instructing the LLM to write multi-step, brittle bash sequences (e.g., handling `git rebase` failures in `ship-sdlc`, or atomic tag deletion in `version-sdlc`).
   - *Fix*: Encapsulate these sequences into headless `scripts/*.sh` helpers. The prompt should execute one script and read a JSON output.
2. **The "Defensive Repetition" Anti-Pattern**:
   - *Issue*: Stating a rule in the "Quality Gates", and then repeating it identically in the "Best Practices", "DO NOT", and "Gotchas" lists (e.g., `pr-sdlc` template rules, `review-sdlc` output constraints).
   - *Fix*: Centralize constraints. State a rule once in the operational step and aggressively prune trailing Gotchas/DO NOTs.
3. **The "Developer Lore & Traceability" Anti-Pattern**:
   - *Issue*: Prompts contain internal issue numbers, requirement tags (`R1`, `Fixes #418`), and historical design rationales meant for human maintainers.
   - *Fix*: Strip all internal tracking metadata and architectural exposition from runtime prompts.
4. **The "JSON Schema & Data Mapping" Anti-Pattern**:
   - *Issue*: Forcing the LLM to memorize and apply complex data mappings (e.g., `jira-sdlc` field mappings, `pr-sdlc` branch-to-label mappings) that can be deterministically calculated.
   - *Fix*: Offload evaluation logic to the `prepare.sh` script, outputting the computed result directly to the LLM.

---

## 3. Implementation Plan (Phased Roadmap)

To safely refactor the plugin while maintaining stability, the optimizations will be executed in 4 distinct phases.

### Phase 1: Script Offloading & Deterministic Execution
*Target: Move multi-step shell logic into robust scripts.*
- [ ] **`execute-plan-sdlc`**: Offload wave WIP commits and resume-detection logic into `check_resume.sh` and `wave_commit.sh`.
- [ ] **`ship-sdlc`**: Consolidate `git rebase` fallback, worktree cleanup, and OpenSpec archive git loops into dedicated helpers.
- [ ] **`commit-sdlc`**: Wrap `git reset --soft` and `stash` pop logic into a single `squash_wip.sh` wrapper.
- [ ] **`version-sdlc`**: Create a deterministic `retag.sh` to handle atomic tag rollback/creation.

### Phase 2: Schema & Data Mapping Delegation
*Target: Move evaluation tables into `prepare.sh` JS layers.*
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
