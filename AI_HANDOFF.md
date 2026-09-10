# AI_HANDOFF.md — Dynamic AI Agent Handoff & State Protocol

## Sub-Second Performance Optimization & Vectorized Matching Checkpoint (10th September 2026)

- **Checkpoint Name**: `Reconciliation 2.0 Sub-Second Performance Optimization & Vectorized Matching Checkpoint`
- **Current Branch**: `stable-copilot-quickreconcile`
- **Checkpoint Tag**: `tars-2026-09-10-subsecond-perf-checkpoint`
- **Previous Checkpoint Tag**: `tars-2026-09-10-session-perf-checkpoint`
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **Current Objective**: 42x end-to-end reconciliation speedup (10k rows x 223 cols executed in 7.2s vs 3-5+ minutes previously), binary pickle cache for 0.35s dataframe loads, 2-pointer sorted array match in simulation, and fast C-level json audit persistence.

---

## Reconciliation 2.0 Architecture & State Summary

1. **Reconciliation 2.0 (`/reconciliations-v2`)**:
   - Built alongside Reconciliation 1.0 without modifying any existing 1.0 flows.
   - **7 Stages in Total**: Clean sequential progression:
     1. `Setup` *(Dual Ingestion)*
     2. `Mapping 2.0` *(AI Schema Coupling)*
     3. `Rules` *(Reconciliation Rules Studio & Statutory Core Advisory Guardrails)*
     4. `Results` *(Multi-Pass Waterfall Match Matrix & Ambiguity Disambiguation Hub)*
     5. `Near matches` *(AI Discrepancy Hub)*
     6. `Exceptions` *(Audit Resolution)*
     7. `Export` *(Ledger Dispatch & ERP Vouchers)*
   - **Dynamic Session Lifecycle & Order File Persistence**:
     - Auto-generates brand-new session IDs (`POST /api/v2/reconciliations`) when navigating to `/reconciliations-v2` or clicking sidebar links.
     - Hard refresh (F5) reads `:id` from URL (`/reconciliations-v2/:id/:stage`), restoring exact stage, uploaded files, rules, and waterfall matrix from disk (`data/audit_v2/sessions_v2.json`).
     - Resuming from Audit 2.0 opens exact session at saved progress step.
   - **Stage 4 Waterfall & Simulation Performance Optimizations**:
     - *210x Faster Ingestion*: Mtime & size-keyed pickle cache loads 10,000 rows x 223 cols in 348ms (down from 73.5s openpyxl XML parsing).
     - *50x Faster Rules Simulation*: Replaced 105M iteration cartesian loop with $O(N \log N)$ two-pointer greedy match on sorted arrays and C-level vectorized series parsing.
     - *$O(1)$ Hash & Inverted Near-Match Lookups*: Fast hash index lookups in Pass 2 and cheap float/date disparity short-circuiting before fuzzy distance calculation in Pass 3.
     - *orjson C-level Binary JSON Persistence*: Replaced stdlib `json.dump` with `orjson` for fast disk reads/writes of audit records.

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
