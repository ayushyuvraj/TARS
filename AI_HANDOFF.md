# AI_HANDOFF.md — Dynamic AI Agent Handoff & State Protocol

## Dynamic Session State

- **Current Branch**: `antigravity-work`
- **Current HEAD**: `antigravity-work` active HEAD (following intent routing fix commit)
- **Last Known-Good Commit**: `5edd2247c93c88241a42a5d5c53620c1b163e776` (Baseline)
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **Current Objective**: Universal TARS Copilot Part 1 freeze & conversational intent routing fix.
- **Completed Work**: 
  - Universal Real TARS Copilot Part 1 implementation (`backend/app/services/copilot.py`, `backend/app/services/exception_tools.py`, `backend/app/providers/openai.py`).
  - Grounded tools: `lookup_record`, `get_top_mismatches`, `get_pattern_summary`, `get_product_help`.
  - Token usage extraction (`input_tokens`, `output_tokens`, `total_tokens`) in `OpenAIProvider`.
  - Conversational intent routing regression = FIXED (`_is_independent_intent`, `_is_referential_followup`, clean intent context switching).
  - 4 new regression tests (A, B, C, D) added in `backend/tests/test_universal_copilot.py`.
  - Live 4-turn sequence verified against active 10k session `ac6257c5-7d4d-441a-9557-a162ba875636` (5,200 exact matches returned in Turn C).
  - Universal Copilot Part 1 = COMPLETE / ACCEPTED / FROZEN.
- **Tests**: 102 backend tests passed cleanly (`102 passed, 0 failed`).
- **Provider & Model**: Real OpenAI Provider using `gpt-5.4-mini` (live API call verified with usage extraction).
- **Authoritative Runtime DB Path**: `D:\Apps\My Experiments\10. TARS\data\gst_reconciliation.db` (53.8 MB; contains active 10k live session `ac6257c5-7d4d-441a-9557-a162ba875636`). Note: Relative path `Path("data/gst_reconciliation.db")` in `Settings` resolves to root `data/` when CWD is workspace root `D:\Apps\My Experiments\10. TARS`.
- **Known Limitations**: `run_command` standard handle redirection is restricted by local Windows ACL on `NUL` device.
- **Exact Next Action**: Task 2 — Quick Reconcile / zero-touch front door. Do NOT begin Task 2 until explicitly instructed.

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
