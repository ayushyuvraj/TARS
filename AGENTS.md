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

7. **RULES CONTROL PLANE INVARIANT**
   - The Rules Wiki must distinguish configurable business rules from mandatory system guardrails.
   - Mandatory safety/integrity rules must never become user-disableable through ordinary UI controls.
   - Macro reconciliation stage order is dependency-controlled and may not be arbitrarily reordered.
   - LLM-created rules must eventually compile only into validated declarative rule objects; LLM-generated executable Python must never become rule logic.
   - Rule status, authority, sequencing and version information shown to users must come from authoritative runtime/configuration truth.


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
