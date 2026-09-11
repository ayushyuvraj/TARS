# AI_HANDOFF.md — Dynamic AI Agent Handoff & State Protocol

## Reconciliation 2.0 Copilot Persistent Memory & Cross-Session Transition Continuity (12th September 2026)

- **Checkpoint Name**: `Reconciliation 2.0 Copilot Persistent Memory & Cross-Session Transition Continuity`
- **Current Branch**: `stable-copilot-quickreconcile`
- **Checkpoint Tag**: `tars-2026-09-12-copilot-persistent-memory-checkpoint`
- **Previous Checkpoint Tag**: `tars-2026-09-11-recon-v2-actionable-copilot-checkpoint`
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **Current Implementation Summary**:
  1. *Actionable Copilot Engine*: Engineered `CopilotActionEngine` (`backend/app/services/copilot_action_engine.py`) with sub-second deterministic intent parsing for conversational commands: `NAVIGATE_STAGE` (forward/backward/direct jumps), `UPDATE_MAPPING` (mapping and unmapping columns), `ADD_RULE` & `TOGGLE_RULE` (live rules injection & activation), and `RUN_RECONCILIATION`.
  2. *Context-Grounded Explanations & Streaming*: Real-time Server-Sent Events (SSE) with `stream_invoke` streaming on LLM provider boundary, contextual "what is this screen" stage breakdowns, and thinking indicators.
  3. *Autonomous Reconcile Pipeline*: Added `POST /api/reconciliations-v2/copilot/auto-reconcile` with dual-workbook GST sanity checks, streaming XLSX probe, automated schema coupling, waterfall execution, and zero-intervention handoff to Results Matrix. Hardened runtime imports (`json`, `datetime`, `AsyncGenerator`, `FastExcelParser`), fixed correlation attribute mapping, and wrapped stream in error-resilient exception handlers.
  4. *Frontend Copilot Bridge*: Created `frontend/src/copilot_v2_bridge.ts` providing reactive telemetry from Stages 1-6 into `CopilotPanel.tsx` and dispatching real-time actions to `DynamicMappingGridV2.tsx`, `ReconciliationV2RulesStage.tsx`, and `ReconciliationV2ResultsStage.tsx`. Added non-blocking error handling to eliminate hanging V1 LLM fallbacks during file upload.
  5. *Audit 2.0 Integration*: Implemented `record_step` and `get_session_steps` in `AuditV2Service`, recording all Copilot interventions under actor `"AI_COPILOT"` with timestamps, parameters, and results.
  6. *Multi-Layer Domain Guardrails (Product / GST / Enterprise Scoping)*: Added dual-layer domain protection in `CopilotActionEngine` (`is_out_of_domain` and prompt guardrail injection) and synchronized `CopilotService` (V1) to strictly deflect out-of-domain questions (cooking recipes, entertainment, sports, general trivia, weather, unrelated code) with a fast, zero-token deflection and thought notification (`Domain guardrail engaged`). Implemented strict word-boundary token matching (`\b`) to eliminate false positives on terms like `"pr"` in `"president"`.
  7. *Dynamic Row Counting & Hardcoding Elimination*: Resolved hardcoded `10,000` / `10,500` fallback constants across `FastExcelParser`, `AuditV2Service`, `reconciliations_v2.py`, `Audit2Workspace.tsx`, and `ReconciliationV2SummaryStage.tsx`. FastExcelParser now performs ultra-fast binary tag scanning (<15ms) when openxml `<dimension>` tags are missing, computing exact row counts for arbitrary workbook sizes (e.g. 1,000 rows GSTR / 1,050 rows PR). Audit 2.0 narrative, manifest, and mathematical conservation now dynamically pull exact row counts from session state and Stage 4 execution results.
  8. *Rigorous Verification*: Validated with dedicated test suite (`backend/tests/test_copilot_v2_actions.py` - 13/13 passed including cross-session and cross-stage transition tests, out-of-domain refusals, greetings, and in-domain GST/KPMG acceptance), core V2 suite (`test_reconciliation_v2.py` - 11/11 passed, total 24/24 backend tests passed), and zero-error production frontend build (`npm run build` in 1.02s).
  9. *Persistent Memory & Cross-Session Transition Continuity*:
     - Implemented unified local storage store `tars_copilot_unified_history_v2` in `CopilotPanel.tsx` ensuring conversation memory persists across drawer open/close (clicking outside backdrop), screen changes, route transitions, and browser reloads until manually cleared via the "Clear" button.
     - Kept `<CopilotPanel />` mounted in DOM in `App.tsx` with `display: copilotOpen ? "flex" : "none"` and `pointerEvents: copilotOpen ? "auto" : "none"` to eliminate remount latency and preserve draft inputs and scroll position.
     - Extended `CopilotMessage` with `CopilotMessageContext` (`sessionId`, `stageKey`, `stageLabel`, `stageNumber`, `routePath`, `timestamp`).
     - Rendered inline visual **Context Switched** dividers in the chat timeline when jumping across sessions or stages, along with subtle message context chips.
     - Engineered background cross-session and cross-stage transition detection in `CopilotActionEngine.stream_response` to explicitly acknowledge shifts in conversation turns (e.g. *(Noting that your previous question pertained to Session '...' [Stage], we are now analyzing Session '...' [Stage].)*).

---

## Reconciliation 2.0 Architecture & State Summary

1. **Reconciliation 2.0 (`/reconciliations-v2`)**:
   - Built alongside Reconciliation 1.0 without modifying any existing 1.0 flows.
   - **6 Clean Sequential Stages**:
     1. `Setup` *(Dual Ingestion)* — Sub-second streaming XLSX probe & deterministic statutory mapping (1.47s total on 10k rows x 223 cols).
     2. `Mapping 2.0` *(AI Schema Coupling)*
     3. `Rules` *(Reconciliation Rules Studio & Statutory Core Advisory Guardrails)*
     4. `Results` *(Multi-Pass Waterfall Match Matrix & Ambiguity Disambiguation Hub)*
     5. `Summary` *(Executive Flight Deck & Risk Intelligence)*
     6. `Export` *(Visual Export Studio & Custom Ledger Designer)* — Universal column universe introspection across both files and calculated intel, arbitrary column reordering, custom header/fill colors, live on-screen & native Excel conditional formatting injection (`openpyxl`), reusable export presets persisted to disk, and a unified top-right Export dropdown (`.xlsx`, `.csv`, configurable DSV `| \t ;`, and `.json`).
   - **Dynamic Session Lifecycle & Order File Persistence**:
     - Auto-generates brand-new session IDs (`POST /api/v2/reconciliations`) when navigating to `/reconciliations-v2` or clicking sidebar links.
     - Hard refresh (F5) reads `:id` from URL (`/reconciliations-v2/:id/:stage`), restoring exact stage, uploaded files, rules, and waterfall matrix from disk (`data/audit_v2/sessions_v2.json`).
     - Resuming from Audit 2.0 opens exact session at saved progress step.
   - **Stage 1 Ingestion & Stage 4 Waterfall Performance**:
     - *20x Faster Ingestion & Schema Mapping*: 10k rows x 223 cols dual ingestion + correlation down from 28.5s to 1.47s.
     - *Sub-30ms Streaming Probe*: Reads top 60 rows from XML streams directly, scaling gracefully to 500,000+ rows in <300ms without memory spikes.
     - *C++ RapidFuzz Acceleration*: Instant <10ms token similarity for arbitrary column counts (15 to 1,500+ cols).
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
