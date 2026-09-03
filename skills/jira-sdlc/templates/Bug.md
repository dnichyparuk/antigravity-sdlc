## Objective

[Bullet list:
- One-line statement of the broken behavior
- Impact on users or system (e.g., data loss, failed operation, incorrect output)
- Affected scope (component, endpoint, user type)]

## Details

### Current Behavior

- [What happens now — one bullet per observable symptom]
- [Error message, incorrect value, or unexpected state]
- [Affected code path or endpoint if known]

### Expected Behavior

- [What should happen instead — one bullet per expected outcome]
- [Specific measurable condition that would indicate correctness]

### Reproduction Steps

1. [Starting condition or setup]
2. [Action that triggers the bug]
3. [Observe the incorrect behavior]

### Environment

- **Environment:** [production / staging / dev]
- **Affected version / release:** [if known]
- **Affected accounts / tenants:** [if scoped to specific users]
- **Frequency:** [always / intermittent — rate if known]

### Supporting Evidence

- [Log excerpt, Sentry link, trace ID, or API response sample]
- [Use a code block for raw output]

## Acceptance Criteria

- [ ] [The broken behavior no longer occurs — specific condition that was failing now passes]
- [ ] [Root cause is addressed — not just the symptom]
- [ ] [No regression — related functionality unaffected]
- [ ] [Error handling — appropriate error surfaced or logged where applicable]

## Development Plan

_To be defined by the development team._

## How to Test

1. **Prerequisites:** [Test data, environment, account setup]
2. **Reproduction (confirm the bug exists before fix):**
   1. [Reproduce step 1]
   2. [Reproduce step 2]
3. **Verification (confirm the fix works):**
   1. [Verify step 1]
   2. [Verify step 2]
4. **Regression check:**
   - [Related functionality to confirm is still working]

## Release Notes

<!-- R25.5 exception: single sentence only — changelog-bound -->
[One sentence describing the fix from the end-user perspective.]
