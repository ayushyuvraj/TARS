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

### 7. Protected Global Registry Invariant
- The following top-level TARS pages are GLOBAL registries and MUST NEVER be conditional on an active reconciliation/session:
  - `/reconciliations`
  - `/client-profiles`
  - `/rules`
  - `/audit`
- `/reconciliations` MUST always query and display the complete persisted reconciliation registry from the authoritative runtime repository.
- It MUST NOT depend on: `sessionId`, `activeReconciliation`, `selected reconciliation`, `Quick Reconcile state`, `Copilot mode`, `route restoration state`, or `current workflow stage`.
- Starting, opening, closing, refreshing, or navigating away from a reconciliation must NEVER make existing reconciliation records disappear.
- A successful API response returning `[]` is a legitimate empty state.
- An API/network/backend error MUST be rendered as an explicit error with Retry and MUST NEVER be represented as "No reconciliations".
- No feature implementation may change this invariant without explicit user approval.

### 8. No Destructive Data Rule
- No coding agent may delete, reset, replace, recreate, merge, migrate, or overwrite the authoritative runtime SQLite database or reconciliation rows unless the user explicitly approves that exact operation.

### 9. Agent Activity Truth Invariant
- Any user-facing Agent Activity event must correspond to a real LangGraph node, service execution, deterministic tool invocation, governance decision, checkpoint, or persisted audit event.
- TARS must never fabricate agent actions, thoughts, progress, tool usage, evidence, percentages, or completion states for UX effect.
- Raw hidden chain-of-thought must never be displayed. Only structured reasoning summaries and execution evidence may be shown.

### 10. Reconciliation Execution UX Invariant
- Every executable reconciliation stage must expose its true execution state.
- A running stage must never leave the user with only an indefinite spinner.
- Where measurable, TARS must show real work-unit progress. Elapsed time must derive from backend execution timestamps. ETA may only be shown when calculated from real observed throughput.
- Every long-running executable stage must support safe cooperative abort preserving completed stages, persisted evidence, and governance history.

### 11. Codex-Wave Execution Invariant
- Whenever TARS performs non-trivial reconciliation work, the user must receive a live compact execution narrative derived from real workflow events.
- The execution wave must communicate current action, recent completed actions, real results, elapsed time, measurable progress, authentic ETA where available, human interrupts, failures, and abort state.
- Raw hidden model chain-of-thought must never be exposed. Only safe execution reasoning summaries and evidence may be displayed.

### 12. TARS Floating Execution Monitor Invariant
- Non-trivial agentic execution must be narrated through the global compact TARS Run Monitor.
- Execution narration must never replace, push down, or obscure the primary business workflow.
- The monitor must be minimizable, restorable, route-persistent, and derived only from real backend execution events.
- Abort confirmation appears only after explicit Abort action.
- Frontend execution state must never contradict authoritative backend state.

### 13. Execution Monitor Isolation Invariant
- TarsRunMonitor is auxiliary UX and must never be capable of crashing or preventing rendering of the primary TARS application.
- The monitor must tolerate absent, partial, stale, or malformed optional progress/activity data.
- Unexpected monitor render errors must be isolated by a monitor-scoped error boundary.
- No monitor failure may alter reconciliation state or financial results.

### 14. Legacy Session + Monitor Safety Invariant
- New UI/telemetry features must remain compatible with previously persisted reconciliations.
- Missing or older telemetry fields must degrade gracefully and may never prevent rendering of a reconciliation.
- TarsRunMonitor is auxiliary UX. No error, malformed payload, stale browser state, missing telemetry, or historical reconciliation shape may crash the primary TARS application.




