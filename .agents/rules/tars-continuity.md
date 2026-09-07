# TARS Agent Safety & Continuity Rules

## Rule Scope
This rule file applies to all agent workflows, subagents, and automated sessions operating within the TARS codebase.

## Mandatory Rules

### 1. Workspace Boundary Control
- All file operations (read, write, delete, list, search) MUST be strictly confined within:
  `D:\Apps\My Experiments\10. TARS`
- Never access, inspect, or modify files or directories outside this root path without explicit user permission.

### 2. Local Checkout Constraint
- Operate only on the active local git repository checkout.
- Never create, delete, switch, or inspect git worktrees unless explicitly directed by the user.

### 3. User Approval Gates
Always halt and request explicit user confirmation before executing any shell command that:
- Deletes files or directories
- Resets git state or changes branches/remotes
- Installs, removes, or upgrades python/node packages
- Modifies `.env` files, environment configuration, or database files
- Writes files outside the workspace root

### 4. Zero Destructive Commands & Baseline Revert Restriction
- The following command patterns are strictly prohibited unless explicit user authorization is given for the specific execution:
  - `git reset --hard`
  - `git clean -fd`
  - `rm -rf` / `rmdir /s` / `del /s`
  - Destructive database migrations/resets
- **NO AGENT MAY RESET, CHECKOUT, OR REVERT TO THE BASELINE COMMIT OR TAG (`5edd2247...` / `tars-pre-antigravity-baseline`) WITHOUT EXPLICIT USER APPROVAL.**
- Working HEAD will advance as development progresses; baseline tag remains the emergency recovery point.

### 5. Secrets Protection
- Never output, log, or include API keys, tokens, or credentials from `.env` or system environment in response text, logs, or persistent documentation.

### 6. Emergency Recovery Baseline vs. Advancing HEAD
- **Emergency Recovery Baseline Tag**: `tars-pre-antigravity-baseline`
- **Emergency Recovery Commit**: `5edd2247c93c88241a42a5d5c53620c1b163e776`
- **Working HEAD**: Advances on working branches (e.g. `antigravity-work`). Read `AI_HANDOFF.md` for active branch/commit state.
