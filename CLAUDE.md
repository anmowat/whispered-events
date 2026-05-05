## Git workflow

- The user has granted standing permission to commit and push directly to `main`.
- Default to pushing to `main` unless the user explicitly asks for a feature branch or PR.
- **At session start, if the harness checked out a `claude/...` branch, immediately
  `git checkout main` and `git pull origin main` before doing any work.** Then
  delete the local `claude/...` branch (`git branch -D claude/...`) so the
  stop-hook doesn't try to push it. This prevents Vercel from running duplicate
  preview + production builds for the same commit.
- Push only to `main`. Never push the session branch to the remote.
- Still ask before destructive operations (force push, reset --hard, branch deletion of remote branches).
