## Objective

[Bullet list:
- What is being validated (feature area, user flow, or requirement)
- Why this plan exists (release gate, regression cycle, new feature sign-off)
- Business outcome being protected by this test coverage]

## Scope

### In Scope

- [Feature area or user flow covered by this test plan]
- [Acceptance criteria or requirement being verified]

### Out of Scope

- [Items explicitly excluded — deferred to another plan or out of bounds for this cycle]

## Test Types

| Type       | Count | Notes                                                |
| ---------- | ----- | ---------------------------------------------------- |
| Smoke      | N     | Critical happy paths; must pass before wider testing |
| Regression | N     | Full automated suite                                 |
| Manual     | N     | Exploratory, visual, or low-automation-ROI flows     |

## Entry Criteria

- [ ] Implementation complete and deployed to test environment
- [ ] Test data available and accessible

## Exit Criteria

- [ ] All high-priority test cases passed
- [ ] All smoke scenarios green
- [ ] No open P1/P2 defects
- [ ] QA sign-off obtained

## Risks and Mitigations

| Risk                                       | Mitigation                                  |
| ------------------------------------------ | ------------------------------------------- |
| [Potential issue that could block testing] | [How it will be addressed or worked around] |

## Notes

- [Known limitations or external dependencies]
- [Deferred items or cross-references to related plans]
