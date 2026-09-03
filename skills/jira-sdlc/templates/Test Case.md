## Preconditions

- [System state or data that must exist before executing this test]
- [User role, permissions, or account type required]
- [Environment: staging / local / other]

## Steps

[Test steps in Gherkin format. Use Scenario Outline with Examples table for parametric cases.]

```gherkin
Feature: <Feature Name>

  Scenario: <Scenario name>
    Given <precondition — the starting state>
    When <action — what the user does>
    Then <expected outcome — what the user observes>
```

## Expected Results

- [Primary observable outcome]
- [Secondary outcomes, if any]
- [Negative assertion — what must NOT happen]

## Test Data

- [Specific data, accounts, configuration, or values required]
- [For Scenario Outline: significance of each example row]

## Notes

- [Edge cases to watch for]
- [Known limitations or dependencies on other test cases]
- [Links to related bugs or requirements]
