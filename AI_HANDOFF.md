# AI_HANDOFF.md — Dynamic AI Agent Handoff & State Protocol

## Dynamic Session State — Audit 2.0 & 7-Stage Reconciliation 2.0 Checkpoint (10th September 2026)

- **Checkpoint Name**: `Audit 2.0 Mission Control, Zero-Loss Persistence & 7-Stage Reconciliation Checkpoint`
- **Current Branch**: `stable-copilot-quickreconcile`
- **Checkpoint Tag**: `tars-2026-09-10-audit-v2-checkpoint`
- **Previous Checkpoint Tag**: `tars-2026-09-10-rules-governance-checkpoint`
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **Current Objective**: Audit 2.0 (`/audit-v2`) mission control with executive telemetry HUD, master-detail historical run journal, 4-tab deep inspector (waterfall micro-durations, error & anomaly captures with AI remediation, terminal logs, control plane with session resume), zero-loss session persistence engine (`audit_v2_service.py`), and 7-stage Reconciliation 2.0 pipeline.

---

## Reconciliation 2.0 Architecture & State Summary

1. **Reconciliation 2.0 (`/reconciliations-v2`)**:
   - Built alongside Reconciliation 1.0 without modifying any existing 1.0 flows.
   - **7 Stages in Total**: Clean sequential progression:
     1. `Setup` *(Dual Ingestion)*
     2. `Mapping 2.0` *(AI Schema Coupling)*
     3. `Rules` *(Reconciliation Rules Studio)*
     4. `Results` *(Reconciliation Matrix)*
     5. `Near matches` *(AI Discrepancy Hub)*
     6. `Exceptions` *(Audit Resolution)*
     7. `Export` *(Ledger Dispatch & ERP Vouchers)*
     *(In-workflow Step 7 Audit removed; all audit capabilities elevated into centralized Audit 2.0)*
   - **Zero Session Loss Guarantee**: Crash-proof disk persistence (`data/audit_v2/` via `AuditV2Service`). State, uploaded workbooks, correlated columns, custom rules, and simulated metrics reload automatically across server reloads and browser refreshes.
   - **Audit 2.0 Mission Control (`/audit-v2`)**: Integrated into top-level navigation, providing full observability across every session and run, sub-millisecond step telemetry, error diagnostics, and a one-click "Resume in Workspace" control plane.

## Operational Capabilities & State Summary

1. **KPMG Zero-Scroll Agentic Command Dashboard (`/dashboard`)**:
   - Integrated full-bleed edge-to-edge widescreen layout (`.workspace--dashboard`).
   - Completely scrollbar-free viewport fit (`calc(100vh - 56px)`).
   - 100% dynamic values (zero hardcoding) polling `api.listReconciliations()`, `api.rulesCatalog()`, `api.profiles()`, and `api.auditEvents()`.
   - Interactive company profile filter dynamically recalculating all 5 KPIs, focusing the active flight deck, and scoping the session matrix and audit stream.
   - Interactive Claude Code / Codex CLI command bar supporting instant commands (`all`, `filter`, `quick`, `rules`, `audit`, `sync`, `copilot`) and execution feedback.
   - Original `/overview` section remains 100% intact and untouched.

2. **Core TARS Application Fully Usable**:
   - Sidebar, top navigation, and workflow routing are 100% functional.
   - Stage 4 Results renders the 6 KPI metrics cleanly plus the collapsible detailed record table toggle ("View detailed record table" / "Collapse detailed record table" with `<ChevronDown />`).

2. **Universal Copilot**:
   - **Global Copilot**: Operates globally across top-level pages (`/overview`, `/quick-reconcile`, `/reconciliations`, `/client-profiles`, `/rules`, `/audit`) without requiring an active session.
   - **Session Copilot**: Operates with full financial evidence and tool access when inside a reconciliation session.
   - **Strict Financial Context Isolation**: Global mode never leaks historical session totals (e.g. 5,200).

3. **Global Registries & Governance Workspaces**:
   - `/reconciliations`: Renders full persisted reconciliation list.
   - `/client-profiles`: Renders `<GovernanceWorkspace>` profiles view unconditionally.
   - `/rules`: Renders `<GovernanceWorkspace>` rules view unconditionally (including `R-001` with `PROPOSE_ONLY` authority).
   - `/audit`: Renders `<AuditTimeline>` wired to `GET /api/reconciliations/audit-events`.

4. **Quick Reconcile Baseline**:
   - Front-door upload component (`/quick-reconcile`) and backend endpoint `/api/reconciliations/quick-reconcile` present and functional.

5. **Historical Live 10k Session Intact**:
   - Authoritative DB: `D:\Apps\My Experiments\10. TARS\data\gst_reconciliation.db` (53.8 MB).
   - Session ID: `ac6257c5-7d4d-441a-9557-a162ba875636`.
   - Persisted Reconciliation Values:
     - **Government Records**: 10,000
     - **Purchase Register Records**: 10,500
     - **Exact Matches**: 5,200
     - **Tolerance Matches**: 719
     - **Resolved Records**: 6,919
     - **Open on Government**: 3,081

6. **Preserved Experimental Monitor Timeline**:
   - Experimental work (`TarsRunMonitor`, execution progress polling, ETA, abort controls, Codex-wave hierarchy) is **NOT** part of this stable branch.
   - It is fully preserved and recoverable on branch `wip-agentic-execution-monitor` (tag `tars-agentic-monitor-experiment-complete-2026-09-08`).
   - > [!IMPORTANT]
   - > Do **NOT** merge `wip-agentic-execution-monitor` into `stable-copilot-quickreconcile` wholesale.

---

## Critical Safety Rules (MANDATORY FOR ALL FUTURE SESSIONS)

1. **Workspace Scope**: Work strictly inside `D:\Apps\My Experiments\10. TARS`. Never view, edit, move, or delete files outside this folder without user authorization.
2. **Local Checkout**: Work exclusively on the active branch (`stable-copilot-quickreconcile`).
3. **Approval Requirements**: Ask for user approval before executing any command that deletes files, changes git state, modifies database schemas, or installs packages.
4. **Destructive Command Ban**: Strictly forbid destructive commands (`git reset --hard`, `git clean -fd`, `rm -rf`, `del /s`, `rmdir /s`). NEVER automatically reset or revert to baseline tags without explicit user approval.
5. **Secret Protection**: Never expose `.env` values, API keys (`sk-`), passwords, or credentials.

---

## Next-Session Resume Instructions

When starting the next session or handing over to another agent:

1. Resume development from branch: `stable-copilot-quickreconcile`
2. Checkpoint tag reference: `tars-2026-09-07-eod-final`
3. Launch command: `.\START_TARS.bat`
