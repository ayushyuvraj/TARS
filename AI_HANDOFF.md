# AI_HANDOFF.md — Dynamic AI Agent Handoff & State Protocol

## Dynamic Session State

- **Current Branch**: `antigravity-work`
- **Current HEAD**: `antigravity-work` active HEAD (following runtime fixes & Global Copilot checkpoint)
- **Last Known-Good Commit**: `5edd2247c93c88241a42a5d5c53620c1b163e776` (Baseline)
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **New Checkpoint Tag**: `tars-runtime-stable-before-quickreconcile-validation`
- **Current Objective**: Checkpoint runtime stable state before Task 2 Quick Reconcile live end-to-end testing.
- **Completed Work**:
  - **Universal Copilot Part 1**: COMPLETE / ACCEPTED / FROZEN.
  - **Global Copilot**:
    - Operates globally across top-level pages (`/overview`, `/quick-reconcile`, `/reconciliations`, `/client-profiles`, `/rules`, `/audit`) without requiring an active reconciliation.
    - Session-specific financial tools remain available ONLY when a reconciliation session is selected.
    - Global conversation dialogue is managed on the frontend (`localStorage` + bounded `conversation_history` payload) and is NOT written into the reconciliation-scoped `copilot_messages` SQLite table.
    - Strict Global -> Session -> Global financial context isolation preserved (Global mode never leaks historical session totals such as 5,200).
  - **Client Profiles / Rules / Audit Restoration**:
    - Unconditional rendering of `<GovernanceWorkspace>` on `/client-profiles` and `/rules` routes.
    - Global audit events endpoint `GET /api/reconciliations/audit-events` added and wired to `/audit`.
    - Preserved `R-001` with `PROPOSE_ONLY` authority and intact audit lineage.
  - **Runtime & Startup Fixes**:
    - Deterministic `PROJECT_ROOT` DB/path resolution in `backend/app/config.py`.
    - Vite API proxy target set to `http://127.0.0.1:8000`.
    - FastAPI parameter default ordering fixed in `backend/app/api/reconciliations.py`.
    - Top-level `import logging` added in `sqlite.py`; automatic background table copying removed from startup.
  - **Live 10k Session Intact**:
    - Authoritative DB `D:\Apps\My Experiments\10. TARS\data\gst_reconciliation.db` (53.8 MB).
    - Session `ac6257c5-7d4d-441a-9557-a162ba875636` intact (Govt = 10,000, PR = 10,500, Exact = 5,200).
  - **Quick Reconcile Status**:
    - Backend workflows and frontend UI implemented.
    - Task 2 is NOT YET fully acceptance-frozen because the complete end-to-end upload/run flow still needs final live testing with synthetic 10k/10.5k files.
- **Manual Startup Status**: `START_TARS.bat` confirmed to launch successfully and run without backend errors.
- **Automated Validation Limitation**: Antigravity `run_command` tool is restricted by local Windows ACL on the `NUL` device.
- **Exact Next Action**: Continue Task 2 live Quick Reconcile testing using the 10k/10.5k synthetic files.

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
