# AI_HANDOFF.md — Dynamic AI Agent Handoff & State Protocol

## Dynamic Session State

- **Current Branch**: `antigravity-work` (or active feature branch)
- **Current HEAD**: `5edd2247c93c88241a42a5d5c53620c1b163e776` (updates as commits are created)
- **Last Known-Good Commit**: `5edd2247c93c88241a42a5d5c53620c1b163e776`
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **Current Objective**: Establish TARS agent continuity system and handoff framework on branch `antigravity-work`.
- **Completed Work**: Created `AGENTS.md`, `AI_HANDOFF.md`, `.agents/rules/tars-continuity.md`, and `.agents/workflows/handoff.md` with updated emergency recovery vs. advancing HEAD protocols.
- **Tests**: Pytest suite in `backend/tests/` passed on frozen baseline.
- **Known Issues**: `run_command` standard handle redirection is restricted by local Windows ACL on `NUL` device; file-system git ref tools are used as fallback.
- **Exact Next Action**: Commit the four continuity files to branch `antigravity-work` and push to origin.

---

## Critical Safety Rules (MANDATORY FOR ALL FUTURE SESSIONS)

1. **Workspace Scope**: Work strictly inside `D:\Apps\My Experiments\10. TARS`. Never view, edit, move, or delete files outside this folder without user authorization.
2. **Local Checkout**: Work exclusively on the current local checkout. Do not create, switch, or modify git worktrees unless requested.
3. **Approval Requirements**: Ask for user approval before executing any command that:
   - Deletes files or directories
   - Resets git state or changes branches/remotes
   - Modifies databases or runs migrations
   - Installs, uninstalls, or updates dependencies
   - Modifies environment variables or `.env` files
   - Writes to paths outside `D:\Apps\My Experiments\10. TARS`
4. **Destructive Command Ban**: Strictly forbid destructive commands (`git reset --hard`, `git clean -fd`, `rm -rf`, `del /s`, `rmdir /s`, etc.). NEVER automatically reset, checkout, or revert to the baseline tag without explicit user approval.
5. **Secret Protection**: Never expose `.env` values, API keys, or credentials in responses, logs, or persistent artifacts.

---

## How Next Gemini / Antigravity Account Should Resume

When starting a new session or handing over to another model/account:

1. **Verify State & Branch**:
   - Read `AI_HANDOFF.md` to get the **Current Branch** and **Current HEAD**.
   - Verify that the emergency recovery tag `tars-pre-antigravity-baseline` exists and points to `5edd2247c93c88241a42a5d5c53620c1b163e776`.
   - Do **NOT** reset or revert HEAD to `5edd2247...`. Active development HEAD advances.

2. **Acknowledge Safety Rules**:
   - Confirm adherence to the workspace boundary (`D:\Apps\My Experiments\10. TARS`).
   - Confirm no files outside `D:\Apps\My Experiments\10. TARS` have been or will be accessed.

3. **Check Product Objectives**:
   - Review `README.md`, `POC_FREEZE.md`, and `DEMO.md` for understanding the GST Agentic Reconciliation Workbench architecture.
   - Do **NOT** modify matching logic, schema definitions, or export formats unless explicitly requested by the user.

4. **Execute Next Action**:
   - Read **Exact Next Action** from `AI_HANDOFF.md` and proceed as instructed by the user.
