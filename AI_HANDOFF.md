# AI_HANDOFF.md — Dynamic AI Agent Handoff & State Protocol

## Katalyst Rebranding, Left Navigation Streamlining & Luxury K Monogram Elevation (13th September 2026)

- **Checkpoint Name**: `TARS Navigation Simplification, Katalyst Rebranding & Luxury K Monogram Elevation`
- **Current Branch**: `stable-copilot-quickreconcile`
- **Checkpoint Tag**: `tars-2026-09-13-katalyst-branding-checkpoint`
- **Previous Checkpoint Tag**: `tars-2026-09-12-screen-elevation-kpmg-hover-checkpoint` (`56efb3e`)
- **Current HEAD Commit**: `6a80266`
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **Current Implementation Summary**:
  1. *Left Panel Navigation Streamlining*: Hid all legacy v1 routes from the primary navigation. Restricted left panel to 4 core items in priority order: `Reconciliation`, `Rules Wiki`, `Audit`, and `Katalyst`. Cleaned up labels by removing `" 2.0"` suffixes while preserving all underlying routes and APIs.
  2. *Default Route Transition*: Updated the root route (`/`) to redirect directly to `/reconciliations-v2`.
  3. *Copilot to Katalyst Rebranding*: Systematically rebranded the assistant throughout UI transcripts, author labels, welcome screens, and backend greeting streams (`backend/app/services/copilot_action_engine.py`) to `Katalyst`. Created `katalyst_v2_bridge.ts`.
  4. *Sculpted "K" Monogram Emblem (`KatalystKBadge.tsx`)*: Created a multi-layered geometric vector emblem of the letter "K" (unifying Katalyst and KPMG) styled with KPMG Royal Navy (`#00338D`), Cobalt (`#005EB8`), Atlantic Cyan (`#0091DA`), and Glacier Sky (`#72CDF4`) gradients, specular core highlights, and diffuse backlight glow.
  5. *Chatbot Window & FAB Elevation*: Transformed the bottom-right closed trigger into a glowing KPMG Jewel Orb button with the "K" insignia. Re-architected the open floating window with an executive KPMG midnight gradient header, cyan outer aura glow (`box-shadow`), live status pulse dot, and subtitle (`KPMG Autonomous Tax Intelligence`).

---

## Reconciliation 2.0 Screen Elevation, Symmetrical Hero Navigation & KPMG Logo Hover Collapse (12th September 2026)

- **Checkpoint Name**: `TARS UI Optimization: Screen Elevation, Symmetrical Hero Navigation & KPMG Logo Hover Collapse`
- **Current Branch**: `stable-copilot-quickreconcile`
- **Checkpoint Tag**: `tars-2026-09-12-screen-elevation-kpmg-hover-checkpoint`
- **Previous Checkpoint Tag**: `tars-2026-09-12-dynamic-thought-streams-checkpoint`
- **Current HEAD Commit**: `56efb3e`
- **Recovery Baseline Tag**: `tars-pre-antigravity-baseline` (`5edd2247c93c88241a42a5d5c53620c1b163e776`)
- **Current Implementation Summary**:
  1. *Exact KPMG Cloud White Shade (`#F7F9FA`)*: Replaced generic stark white with the official KPMG Digital Design System neutral (`#F7F9FA` KPMG Cloud / Cool Gray 1). Paired with KPMG Ice Tint (`#F0F4F8`) for telemetry bars and crisp white (`#FFFFFF`) for elevated cards and inputs.
  2. *Header Theme Toggle (1-Click Switcher)*: Added a dedicated `[ ☾ / ☀ ]` button into the header action cluster. Clicking toggles instantly between Light Mode (KPMG Cloud `#F7F9FA`) and Dark Mode (KPMG Midnight Navy `#070E17`). Automatically persists user choice in `localStorage` and defaults to Light Mode.
  3. *5-Tier High-Contrast Visual Separation*: Engineered high-contrast physical demarcation against white workspace backgrounds:
     - 4-Tier volumetric lighting shadow with KPMG Navy brand tinting (`0 0 0 1px rgba(0, 51, 141, 0.14), 0 0 0 4px rgba(0, 145, 218, 0.08), 0 16px 36px -4px rgba(0, 32, 74, 0.18), 0 32px 80px -12px rgba(0, 18, 48, 0.22)`).
     - Prismatic gradient crown (3.5px gradient ribbon `#00338D ➔ #005EB8 ➔ #0091DA ➔ #72CDF4 ➔ #483698`) along the upper border.
     - Heavy frosted glassmorphism (`backdrop-filter: blur(28px) saturate(180%)`).
     - Executive user speech bubble in KPMG Heritage Navy to Cobalt gradient (`#00338D` to `#005EB8`) with white typography.
     - Soft KPMG Ice Blue transition pills for session and stage switches.
  4. *Interactive Bidirectional Card Resizing*: Added smooth drag-to-resize controls to the floating card:
     - Top-left diagonal corner grip handle (`.tars-copilot-resize-nw`) with KPMG-styled micro-grip indicator.
     - Top edge (`.tars-copilot-resize-n`) and left edge (`.tars-copilot-resize-w`) draggable borders with visual hover accents.
     - Anchored at bottom-right, smoothly expanding inward without pushing off-screen.
     - Double-click reset to default dimensions (`440px × 640px`).
     - Persistent custom dimensions in `localStorage` under `tars_copilot_floating_size`.
     - Zero transition lag during active drag via `.is-resizing` (60 FPS fluid tracking).
  5. *Real-Time Dynamic Cognitive Reasoning & Raw Thought Streams*:
     - Eliminated hardcoded static telemetry steps (`ctx_probe`, `statutory_eval`, `matrix_scan`, `synth`).
     - Implemented real-time dynamic cognitive reasoning in `copilot_action_engine.py` that introspects live session state (matrix distribution across exact, tolerance, near-match, and unresolved records), Rule R-01 to R-05 heuristics (e.g. Levenshtein edit distance <= 2, date proximity <= 15 days), and GST statutory provisions (Section 16(2)(aa), Rule 36(4)).
     - Emits unedited raw thought streams as `thought_content` SSE events.
     - Updated `CopilotPanel.tsx` and `api.ts` with `thought_content` tracking, real-time elapsed duration calculation (`reasoning_duration_ms`), and collapsible Claude Code-style `ThoughtAccordion` rendering formatted markdown thoughts.
     - Every unique question produces a completely distinct, question-specific cognitive monologue with zero hardcoded boilerplate.
  6. *Strict Invariant Enforcement*: Only `copilot_action_engine.py`, `api.ts`, `CopilotPanel.tsx`, and `copilot_agentic.css` were updated. Zero core reconciliation matching algorithms, database schemas, or business policies were altered. Full verification passed via browser subagent.
  7. *Global Top Bar Elimination & Usable Screen Elevation*:
     - Completely removed the 64px `<header className="app-topbar">` across all screens, reclaiming vertical screen area for match tables, steppers, and telemetry headers.
     - Preserved all functional capabilities: added dedicated `TARS Copilot` launcher item with `Ctrl+K` hint into primary sidebar navigation; preserved `PO` user identity and dynamic sync indicator in the sidebar footer (`.sidebar-foot`); preserved mobile navigation drawer trigger for viewports $\le 880\text{px}$.
     - Recalibrated `.workspace--v2`, `.workspace--audit-v2`, `.workspace--dashboard`, and parallel dock layouts to `100vh`. Verified via live browser subagent across all major routes.
  8. *Universal Stage Hero Banner & Symmetrical Navigation Blueprint*:
     - Standardized the Stage Hero container blueprint (`.v2-stage-hero`, `.v2-results-hero`) across Reconciliation 2.0.
     - Placed the symmetrical **Back Switch** (`.v2-hero-btn-back`) on the far left of the blue box, vertically centered with exact matching dimensions (`7px 16px` padding, `8px` border radius, `12px` bold font), smooth glassmorphic hover elevation, and a crisp left arrow icon.
     - Centered the Stage Title, Stage Tag badge, and accounting scope description.
     - Aligned secondary stage actions (e.g. `Re-run Waterfall`) alongside the primary **Next Switch** (`Proceed to Summary Dashboard →`) on the far right.
     - Verified bidirectional navigation in browser between Stage 3 (Rules) and Stage 4 (Results).
  9. *Interactive KPMG Logo Collapse Toggle & Separate Button Removal*:
     - Removed the standalone `<button className="sidebar-collapse">` ("Collapse sidebar" / "Expand") completely from the sidebar, reclaiming 48px of vertical sidebar space and bringing navigation items up.
     - Converted the KPMG brand logo in the sidebar header into an interactive morphing toggle button (`.brand-logo-toggle`).
     - Implemented a smooth hover micro-animation: on hover, the KPMG logo smoothly shrinks and rotates while the collapse icon (`<PanelLeftClose>` when expanded, `<PanelLeftOpen>` when collapsed) pops in with a luminous cyan glow (`drop-shadow(0 2px 6px rgba(56, 189, 248, 0.45))`) and frosted glass halo badge (`background: rgba(0, 94, 184, 0.24)`).
     - Clicking smoothly toggles between expanded (232px) and collapsed (72px rail) states.
     - Fully verified in browser with live subagent across hover, collapse, collapsed-hover, and restore-expanded flows.

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
