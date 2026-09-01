---
name: verify-pipeline-sdlc
description: "Use this skill to analyze a failed CI run on a PR and either apply a minimal fix or emit a proposal. Dispatched automatically by ship-sdlc's verify-pipeline step under --auto, or invoked standalone via /verify-pipeline-sdlc --pr <N>. Triggers on: analyze CI failure, fix failing checks, post-PR CI verification, verify-pipeline."
user-invocable: true
argument-hint: "[--pr <number>] [--logs <path-or-string>] [--auto]"
model: gemini-3.7-flash-medium
---

# Verify Pipeline (SDLC)

Analyze failed CI logs, classify the root cause via a deterministic Node helper, and either apply a minimal in-place fix or emit a proposal as a single JSON line on stdout. Used by ship-sdlc's `verify-pipeline` step under `flags.auto`; also user-invocable for standalone CI failure analysis on any PR.

**Announce at start:** "I'm using verify-pipeline-sdlc (sdlc v{sdlc_version})." — extract the version from the `sdlc:` line in the session-start system-reminder. If no version is in context, omit the parenthetical.

---

## Step 1: CONSUME — parse args, load logs (R1, R6)

Parse `--pr <N>`, `--logs <path-or-string>`, `--auto` from `$ARGUMENTS`.

If both `--pr` and `--logs` are missing, emit `{"status":"abort","reason":"--pr or --logs required"}` and stop (E1).

If `--logs` is provided: when the value is a filesystem path, read its contents; otherwise treat the value as the log text inline.

If `--logs` is omitted but `--pr` is present (R6): resolve logs internally via `lib/git.js::fetchFailedCheckLogs` for the latest failed run on the PR. The Node code path for this is inline:

```shell
<PLUGIN_ROOT>/skills/verify-pipeline-sdlc/scripts/fetch_logs.sh
```
> **Contract (Input/Output):**
> - **Input**: PR context.
> - **Output**: Prints CI failure logs to stdout.

If gh is unauthenticated and logs cannot be resolved, emit `{"status":"abort","reason":"gh not authenticated"}` and stop (E2).

## Step 2: CLASSIFY — invoke the deterministic classifier (R2)

Pipe the resolved log text into the classifier helper:

```shell
<PLUGIN_ROOT>/skills/verify-pipeline-sdlc/scripts/classify_logs.sh
```
> **Contract (Input/Output):**
> - **Input**: Log text via stdin.
> - **Output**: Prints JSON verdict on stdout.

Read the JSON verdict on stdout: `{"category": "<one of seven>", "signals": [...]}`.

The seven categories are: `lint`, `test-failure`, `type-error`, `build-error`, `dependency`, `infra`, `unknown` (R2).

## Step 3: PROPOSE OR APPLY (R3, R4, R9)

Routing by category:

- **`lint`, `test-failure`, `type-error`**: Actionable. When `--auto` is set (R9), use the `Edit` tool to apply the minimal fix (R3): correct the lint violation, fix the failing assertion, add the missing import or correct the type annotation. Do NOT scaffold abstractions or refactor.
- **`build-error`, `dependency`, `infra`**: Non-trivial. Emit a proposal regardless of `--auto` (R4) — these typically require human judgement.
- **`unknown`**: fall through to `proposal` verdict with the raw log excerpt as `summary` (E3).

When NOT running with `--auto`, ALWAYS emit a proposal (no automatic edits) regardless of category (R4, R9).

C1 prohibition: never run `git commit`, `git push`, or any state-changing git command. C2: never modify files outside the project root.

## Step 4: VERDICT — single JSON line on stdout (R5)

Emit exactly one of:

```json
{"status":"fix-applied","filesChanged":["path/a","path/b"],"summary":"<one-line summary>"}
{"status":"proposal","summary":"<diagnosis>","suggestedPatch":"<diff-or-prose>"}
{"status":"abort","reason":"<reason>"}
```

The single JSON line is the contract with the parent dispatcher (ship-sdlc) — anything else on stdout breaks the verdict parser. Logs and progress go to stderr.

## What's Next

When `fix-applied`: ship-sdlc's verify-pipeline branch dispatches `commit-sdlc` to commit and push the fix, then re-polls CI (R7 — this skill MUST NOT commit itself).

When `proposal`: the user (interactive) or ship-sdlc (logging) reads the proposal and decides whether to apply.

When `abort`: ship-sdlc treats this as a skip-with-warning and proceeds to `await-remote-review`.

## See Also

- [`/ship-sdlc`](../ship-sdlc/SKILL.md) — invokes this skill from the verify-pipeline step under `--auto`
- [`/commit-sdlc`](../commit-sdlc/SKILL.md) — invoked by ship-sdlc after this skill returns `fix-applied`
