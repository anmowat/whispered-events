## Git workflow

- The user has granted standing permission to commit and push directly to `main`.
- Default to pushing to `main` unless the user explicitly asks for a feature branch or PR.
- Skip the per-session `claude/...` branch — work on `main` directly.
- Still ask before destructive operations (force push, reset --hard, branch deletion).
