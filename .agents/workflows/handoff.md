# Workflow: Agent Session Handoff & Resume

## Purpose
Standardized procedure for handing off and resuming TARS repository management across AI agent sessions and accounts while maintaining safety and operational continuity.

---

## Step 1: Pre-Execution Safety Verification
Before performing any task in a new session:

1. Confirm working directory is strictly:
   `D:\Apps\My Experiments\10. TARS`
2. Verify no files outside `D:\Apps\My Experiments\10. TARS` have been accessed.
3. Review safety rules in `AGENTS.md` and `.agents/rules/tars-continuity.md`.

---

## Step 2: Emergency Recovery Tag & Git State Check
Inspect repository status without altering state:

1. Verify that the emergency recovery baseline tag `tars-pre-antigravity-baseline` exists and points to commit `5edd2247c93c88241a42a5d5c53620c1b163e776`.
2. Inspect `.git/HEAD` and active branch ref to record the **Current Branch** and **Current HEAD**.
3. Do **NOT** expect HEAD to equal `5edd2247...` as development advances on working branches.
4. Do **NOT** reset or revert HEAD to the baseline tag without explicit user instructions.
5. Verify git remote configuration (`.git/config` points to `https://github.com/ayushyuvraj/TARS.git`).

---

## Step 3: Continuity Verification
Check that mandatory continuity files exist and are intact:
- [AGENTS.md](file:///D:/Apps/My%20Experiments/10.%20TARS/AGENTS.md)
- [AI_HANDOFF.md](file:///D:/Apps/My%20Experiments/10.%20TARS/AI_HANDOFF.md)
- [.agents/rules/tars-continuity.md](file:///D:/Apps/My%20Experiments/10.%20TARS/.agents/rules/tars-continuity.md)
- [.agents/workflows/handoff.md](file:///D:/Apps/My%20Experiments/10.%20TARS/.agents/workflows/handoff.md)

---

## Step 4: Post-Task Handoff Update Protocol
When completing a task or ending a session:
1. Update `AI_HANDOFF.md` with the latest:
   - **Current Branch**
   - **Current HEAD**
   - **Last Known-Good Commit**
   - **Recovery Baseline Tag**
   - **Current Objective**
   - **Completed Work**
   - **Tests**
   - **Known Issues**
   - **Exact Next Action**
2. Present the updated state to the user in the final session report.
