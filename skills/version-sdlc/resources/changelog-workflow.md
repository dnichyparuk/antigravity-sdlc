### Branch C: Changelog-Update Workflow (`flow === "changelog-update"`)

This branch activates when `/version-sdlc --changelog` is run without a bump type.
It updates the CHANGELOG entry for the **already-tagged current version** — useful after
squash merges add commits that weren't captured when the release was originally tagged.

### Step 1 (CONSUME): Read the Context

Read `VERSION_CONTEXT_JSON`. Extract:

| Field | Description |
| ----- | ----------- |
| `currentVersion` | The current version string (e.g. `1.2.3`) |
| `currentTag` | The git tag for the current version (e.g. `v1.2.3`) |
| `previousTag` | The tag immediately before the current one (e.g. `v1.2.2`), or `null` for the first release |
| `commits` | Commits between `previousTag` and `currentTag` — the actual commits that make up this release |
| `commits[].ticketIds` | Ticket IDs extracted from each commit |
| `changelog.exists` | Whether `CHANGELOG.md` exists |
| `changelog.filePath` | Path to the changelog file |
| `changelog.currentContent` | Current content of the changelog (truncated to 5000 chars) |
| `config.ticketPrefix` | Optional ticket prefix for filtering ticket IDs |
| `flags.noPush` | Whether to skip pushing |
| `flags.auto` | Whether `--auto` was passed — skip interactive approval |

### Step 2 (CHECK): Validate Preconditions

- If `commits.length === 0`: inform the user `"No commits found between ${previousTag} and ${currentTag}. The changelog may already be up to date."` and stop.
- If `changelog.exists === false`: inform the user that no CHANGELOG.md was found and offer to create one: `"CHANGELOG.md does not exist. Run /version-sdlc patch --changelog to create it as part of a release, or confirm to create it now with just the current version entry."` Ask yes/no.

### Step 3 (PLAN): Draft Updated Changelog Entry

Draft an updated `## [currentVersion]` changelog entry from the commits between `previousTag` and `currentTag`:

- Use the same commit-type mapping as Branch B Step 2 (`feat` → **Added**, `fix` → **Fixed**, etc.)
- Apply the same ticket ID rules as Branch B Step 2 (append when `config.ticketPrefix` is set)
- If an existing `## [currentVersion]` section is present in `changelog.currentContent`:
  - Compare the existing entries against the commits
  - Keep entries that are still accurate
  - Add entries for commits not yet represented
  - Remove entries that cannot be traced to any commit in the `commits` array (they may be fabricated or from squashed commits that are no longer visible)
  - **Preserve user-edited entries** — if an entry looks hand-written (not matching a commit description directly), keep it with a note
- If no existing entry: draft fresh from the commits

### Step 4 (CRITIQUE): Self-review

Apply the same quality gates as Branch B: no fabricated entries, all user-facing commits represented, changelog completeness.

### Step 5 (IMPROVE): Revise Based on Critique

Fix any issues found in Step 4.

### Step 6 (PRESENT): Show the User

Display side-by-side (or sequentially with clear labels):

```
Existing changelog entry for [currentVersion]:
──────────────────────────────────────────────
[show existing ## [currentVersion] section, or "(none)" if no existing entry]

Updated changelog entry:
──────────────────────────────────────────────
[show the new draft entry]

What changed: [brief summary of additions/removals]
```

Use AskUserQuestion to ask:
> Proceed with this changelog update?

Options:
- **yes** — apply the update
- **edit** — tell me what to change
- **cancel** — abort

If the user chooses **edit**, ask what to change, revise, and present again. Loop until explicit **yes** or **cancel**.

**Auto mode:** When `flags.auto` is true, skip the AskUserQuestion prompt entirely. Still display the existing vs. updated changelog comparison for visibility, then proceed directly to Step 7. Treat the response as an implicit `yes`.

### Step 7 (EXECUTE): Apply the Update

On `yes`:

1. If `changelog.exists === false`: create CHANGELOG.md with a standard header + the new entry.
2. If the `## [currentVersion]` section exists in the changelog: use the Edit tool to replace it with the updated entry.
3. If the `## [currentVersion]` section does not exist yet: prepend the entry after the `## [Unreleased]` section (if present) or after the file header.
4. Stage: `git add <changelog.filePath>`
5. Commit: `git commit -m "docs: update changelog for ${currentTag}"`
6. Push (unless `flags.noPush === true`): `git push`

**Do NOT create a new tag.** This workflow only updates the changelog.

Display result:
```
✓ Changelog updated for ${currentTag}.
  Commit: abc1234 — docs: update changelog for v1.2.3
  Pushed: yes → origin/main
```
