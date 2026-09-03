# github-sdlc

The `github-sdlc` skill manages GitHub issues directly from your project via the GitHub CLI (`gh`). It supports reading, creating, editing, and managing issues.

## Prerequisites

- **GitHub CLI (`gh`)**: Must be installed and authenticated (`gh auth login`).
- **Repository Context**: It operates on the current repository context by default.

## Arguments

- `--repo <owner/repo>`: Manually specify the repository to interact with. If omitted, the default repository in the current directory is used.

## Usage Examples

**Creating an Issue:**
```
/github-sdlc create an issue for the login bug
```

**Viewing an Issue:**
```
/github-sdlc view issue #12
```

**Adding a Comment:**
```
/github-sdlc comment on issue #12 that we are working on it
```

**Searching Issues:**
```
/github-sdlc list open bugs assigned to me
```

## Error Recovery

If you encounter authentication or permission errors:
- Ensure you have run `gh auth login` with the appropriate scopes.
- For private repositories, verify that your account has the correct access.
- Use `--repo` if the current directory is not linked to the intended GitHub repository.
