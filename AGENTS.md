# AGENTS.md — TARS Agent Continuity & Safety Guidelines

## Overview
This document specifies operational guidelines, safety boundaries, and continuity protocols for all AI agents working on the TARS (GST Agentic Reconciliation Workbench) repository.

---

## Critical Safety Rules (MANDATORY FOR ALL AGENT SESSIONS)

1. **Workspace Boundary**
   - Work **ONLY** inside: `D:\Apps\My Experiments\10. TARS`
   - Do **NOT** access, modify, delete, rename, or inspect files outside that folder unless explicitly approved by the user.

2. **Repository & Checkout Boundary**
   - Work on the current **LOCAL** repository checkout only.
   - Do **NOT** create or switch git worktrees unless explicitly requested by the user.

3. **Explicit User Approval Required**
   Before executing any terminal command that performs any of the following, **STOP and ask for explicit user approval**:
   - Deletes files
   - Resets git state
   - Changes git branches (unless explicitly instructed in the current task)
   - Changes git remotes
   - Modifies the database schema or data
   - Installs or uninstalls packages
   - Changes environment configuration (`.env`, config files)
   - Writes outside the project folder

4. **Strictly Forbidden Destructive Commands**
   Never run destructive commands, including but not limited to:
   - `git reset --hard`
   - `git clean -fd`
   - `rm -rf` / `rmdir /s` / `del /s`
   - Destructive database resets or migration commands
   unless the user explicitly approves them in the turn. NEVER automatically reset, checkout, or revert to the baseline.

5. **Secrets & Credentials Safety**
   - Never print, log, display, or expose `.env` secrets, API keys, or credentials.
   - Ensure all configuration files exclude secret values when displaying summaries or audit logs.

6. **Product Functionality Guardrails**
   - Do **NOT** alter product functionality, matching algorithms, governance policies, or export structures unless requested.
   - Python code and persisted structured contracts remain the source of financial truth.

7. **PROTECTED GLOBAL REGISTRY INVARIANT**
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

8. **NO DESTRUCTIVE DATA RULE**
   - No coding agent may delete, reset, replace, recreate, merge, migrate, or overwrite the authoritative runtime SQLite database or reconciliation rows unless the user explicitly approves that exact operation.

9. **AGENT ACTIVITY TRUTH INVARIANT**
   - Any user-facing Agent Activity event must correspond to a real LangGraph node, service execution, deterministic tool invocation, governance decision, checkpoint, or persisted audit event.
   - TARS must never fabricate agent actions, thoughts, progress, tool usage, evidence, percentages, or completion states for UX effect.
   - Raw hidden chain-of-thought must never be displayed. Only structured reasoning summaries and execution evidence may be shown.

10. **RECONCILIATION EXECUTION UX INVARIANT**
    - Every executable reconciliation stage must expose its true execution state.
    - A running stage must never leave the user with only an indefinite spinner.
    - Where measurable, TARS must show real work-unit progress. Elapsed time must derive from backend execution timestamps. ETA may only be shown when calculated from real observed throughput.
    - Every long-running executable stage must support safe cooperative abort preserving completed stages, persisted evidence, and governance history.

11. **CODEX-WAVE EXECUTION INVARIANT**
    - Whenever TARS performs non-trivial reconciliation work, the user must receive a live compact execution narrative derived from real workflow events.
    - The execution wave must communicate current action, recent completed actions, real results, elapsed time, measurable progress, authentic ETA where available, human interrupts, failures, and abort state.
    - Raw hidden model chain-of-thought must never be exposed. Only safe execution reasoning summaries and evidence may be displayed.

12. **TARS FLOATING EXECUTION MONITOR INVARIANT**
    - Non-trivial agentic execution must be narrated through the global compact TARS Run Monitor.
    - Execution narration must never replace, push down, or obscure the primary business workflow.
    - The monitor must be minimizable, restorable, route-persistent, and derived only from real backend execution events.
    - Abort confirmation appears only after explicit Abort action.
    - Frontend execution state must never contradict authoritative backend state.

13. **EXECUTION MONITOR ISOLATION INVARIANT**
    - TarsRunMonitor is auxiliary UX and must never be capable of crashing or preventing rendering of the primary TARS application.
    - The monitor must tolerate absent, partial, stale, or malformed optional progress/activity data.
    - Unexpected monitor render errors must be isolated by a monitor-scoped error boundary.
    - No monitor failure may alter reconciliation state or financial results.

14. **LEGACY SESSION + MONITOR SAFETY INVARIANT**
    - New UI/telemetry features must remain compatible with previously persisted reconciliations.
    - Missing or older telemetry fields must degrade gracefully and may never prevent rendering of a reconciliation.
    - TarsRunMonitor is auxiliary UX. No error, malformed payload, stale browser state, missing telemetry, or historical reconciliation shape may crash the primary TARS application.

---

## Baseline Reference & Working Branch Protocol

- **Emergency Recovery Baseline Tag**: `tars-pre-antigravity-baseline`
- **Emergency Recovery Commit**: `5edd2247c93c88241a42a5d5c53620c1b163e776`
- **Remote**: `origin` (`https://github.com/ayushyuvraj/TARS.git`)

> [!IMPORTANT]
> The tag `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`) is the **IMMUTABLE KNOWN-GOOD RECOVERY POINT**. It is **NOT** the commit that future sessions should always expect HEAD to equal.
> As development proceeds, the active working HEAD will advance. Future agents must **NEVER** automatically reset or revert to `5edd2247...`.
> Agents MUST read [AI_HANDOFF.md](AI_HANDOFF.md) at the start of every session to obtain the active **Current Branch** and **Current HEAD**.

---

## Technical Stack & Key Entry Points

- **Backend**: FastAPI (Python 3.11+), SQLite persistence (`backend/app/repositories/`), Pydantic domain models (`backend/app/domain/`), LLM provider boundary (`backend/app/providers/`), Pytest suite (`backend/tests/`).
- **Frontend**: React + TypeScript + Vite (`frontend/src/`), TailwindCSS / CSS design tokens.
- **Data Fixtures & Samples**: `sample_data/` containing synthetic GSTR-2B, Purchase Register, and Ground Truth files.
- **Documentation**:
  - `README.md` — Core repository architecture and endpoints.
  - `POC_FREEZE.md` — Phase 7C baseline scope and productionization boundaries.
  - `DEMO.md` — Reproducible 18-step presentation flow.

---

## Handoff & Session Protocols

Every new agent session or account change **MUST**:
1. Read `AGENTS.md` and `AI_HANDOFF.md`.
2. Inspect git status, current branch, and current HEAD hash.
3. Verify that the emergency recovery tag `tars-pre-antigravity-baseline` exists and points to `5edd2247c93c88241a42a5d5c53620c1b163e776`.
4. Do NOT revert or reset HEAD to the baseline tag without explicit user instructions.
5. Follow the safety rules outlined above strictly without deviation.
