# AI_HANDOFF.md — Dynamic AI Agent Handoff & State Protocol

## Dynamic Session State — Rules Engine 2.0 Studio Checkpoint (10th September 2026)

- **Checkpoint Name**: `Rules Engine 2.0 Studio & Waterfall Simulation Checkpoint`
- **Current Branch**: `stable-copilot-quickreconcile`
- **Current HEAD Commit**: `6872594` (`feat(rules-v2): implement Rules Engine 2.0 waterfall matching and live simulation studio`)
- **Checkpoint Tag**: `rules-engine-v2-complete`
- **Previous Checkpoint Tag**: `reconciliation-v2-setup-complete`
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **Current Objective**: Stage 3 Rules Engine 2.0 with progressive waterfall matching, column-level normalizations (whitespace, symbol stripping, prefix removal, zero trimming, case fold), commercial tolerance windows (amount and date lag), and live dataset simulation HUD. Original Rules Wiki 1.0 remains 100% intact.

---

## Reconciliation 2.0 Architecture & State Summary

1. **Reconciliation 2.0 (`/reconciliations-v2`)**:
   - Built alongside Reconciliation 1.0 without modifying any existing 1.0 flows.
   - **Zero-Scroll Setup Canvas**: Fits standard laptop/desktop viewports (1440x765) without vertical scrolling.
   - **Pristine White Background**: Pure clean `#ffffff` canvas background across workspace, root, and stage views.
   - **Compact Focused Ledger Bays**: Tax Authority Ledger and Client Accounting Ledger boxes are reduced in size and centered (max-width 1040px, 200px height).
   - **Really Subtle Trust Cards**: Three bottom cards styled with ultra-light borders, transparent icon containers, muted slate typography, and no heavy drop shadows.
   - **Multi-Step Dynamic Chain of Thought Console**: Live dark-mode HUD (`.v2-cot-console`) displaying Step 1, 2, and 3 simultaneously with millisecond completion badges, live elapsed timer, and status icons so users can see previous steps when at Step 3/3.
   - **Stage 3 Rules Engine 2.0 Studio**: Progressive waterfall pipeline (Tier 1: Strict Identity $\to$ Tier 2: Progressive String Normalization $\to$ Tier 3: Commercial Tolerance Window), column-pair inspectors, interactive normalization toggles, tolerance sliders, and live dataset simulation HUD. Original Rules Wiki 1.0 remains 100% intact.

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
