# GST Agentic Reconciliation Workbench

A frozen Phase 7C working POC for reconciling Government GST / GSTR-2B data with a client Purchase Register. Python remains the source of financial truth; optional models interpret, classify, and communicate through controlled tools; consequential matching and export actions require explicit human approval.

Use [DEMO.md](DEMO.md) for the reproducible 18-step presentation, [reports/PHASE7C_FINAL_EVALUATION.md](reports/PHASE7C_FINAL_EVALUATION.md) for consolidated verification, and [POC_FREEZE.md](POC_FREEZE.md) for the frozen scope and productionization boundary.

## Implemented

- FastAPI upload/session/summary/audit APIs
- Source-name-independent Excel header detection and bounded column profiling
- Explicit canonical GST schema with aliases, types, and matching metadata
- Hybrid deterministic/LLM schema proposals through the provider abstraction
- Mechanical conflict, required-field, datatype, and GSTIN validation
- Editable and persisted mappings with explicit human confirmation
- Durable LangGraph SQLite checkpoint at the approval boundary
- Deterministic exact matching across GSTIN, invoice number/date/type, taxable value, rate, IGST, CGST, SGST, and cess
- One-to-one PR record consumption enforced in both the engine and SQLite schema
- SQLite repository abstraction and structured audit events
- Model-agnostic `LLMProvider` contract, real OpenAI adapter, and explicit Anthropic/Gemini Phase 1 stubs
- React + TypeScript + Vite upload, mapping-review, validation, and results UI
- Pytest validation against the internal Ground Truth workbook
- Provider-agnostic schema-mapping evaluation harness and renamed ERP fixtures
- Provider-independent reconciliation policy contract and mechanical validator
- Conservative no-LLM interpreter for explicit INR/day policies plus structured LLM interpretation
- Durable policy approval checkpoint with persisted drafts, edits, revisions, and confirmation
- Deterministic tolerance engine restricted to unmatched records with reciprocal-uniqueness conflict handling
- Persisted variance evidence and filterable exact/tolerance/unresolved results
- Provider-agnostic natural-language policy evaluation harness
- GSTIN-blocked near-match candidate generation with explicit invoice normalization and RapidFuzz similarity
- Deterministic feature scores, reciprocal-best checks, configurable safety thresholds, and ambiguity isolation
- Persisted approve/reject and revalidated bulk approval with no automatic near-match consumption
- Candidate comparison UI with safe, ambiguous, material-mismatch, GST-only, and PR-only queues
- Ground Truth near-match evaluator covering recall, precision, false matches, ambiguity, and duplicate consumption
- Deterministic exception tools for breakdowns, record search, variance explanations, ranked candidates, and policy simulation
- Optional structured semantic classification with human confirm/override/unclassified review states and clean provider-unavailable behavior
- Persistent Copilot conversations grounded in controlled tools and explicit evidence references
- Explicit ambiguous-candidate selection persisted as `HUMAN_SELECTED`, with duplicate-consumption protection and audit events
- Provider/model evaluation harnesses for semantic classification and Copilot tool/factual behavior
- Independently persisted client profiles with saved mappings, policies, profile versions, compatibility checks, and new-session references
- Deterministic pattern detection with minimum support, acceptance-ratio gating, duplicate suppression, evidence, dismissal, and draft conversion
- Declarative rule library with provenance, read-only simulation, approval/activation/disable lifecycle, immutable version history, and execution records
- Profile/rule-aware Copilot tools and a filterable user-facing audit timeline
- Conservative rule `ActionAuthority`; existing and new rules default to `PROPOSE_ONLY`, with zero automatic reconciliation changes
- Template-driven KIGS GSTR-2B reconciliation adapter using confirmed CP/PR field names and a configured POC fallback schema
- Explicit Final Review gate, export validation, immutable export versions, SHA-256 integrity references, downloads, and stale-history indicators
- Five-sheet `.xlsx` package: `KIGS_Reconciliation`, `Summary`, `Unresolved_Exceptions`, `Configuration`, and `Audit_Summary`
- Formula-injection neutralization for untrusted exported text, sanitized upload filenames, bounded upload size, and corrupt/empty workbook rejection

Formal KIGS compatibility is not claimed. The official full header-only workbook is still required to verify every field name, enum, and final field order. When it is placed at `sample_data/KIGS_GSTR2B_Reco_Template.xlsx`, the adapter discovers its headers and order without code changes, retains unknown fields, and maps recognized fields.

The frozen POC is not production-ready or certified. It does not include enterprise authentication/RBAC, a formal security assessment, production cloud deployment, live KIGS integration, or real-client production benchmarking. Anthropic and Gemini adapters remain stubs, and no real external provider evaluation was run for Phase 7C. `ReconciliationPercentage` stays blank because its official business semantics remain unconfirmed.

## Project structure

```text
backend/
  app/
    api/             FastAPI transport layer
    domain/          Stable Pydantic contracts
    providers/       Replaceable LLM provider boundary
    repositories/    Persistence protocol and SQLite implementation
    services/        Parsing, mapping, matching, orchestration services
    export/          KIGS field registry and template schema adapter
    workflows/       LangGraph workflow boundary
    evaluation/      Provider/model evaluation harness
  scripts/           Optional provider evaluation command
  tests/
frontend/
  src/               React UI and typed API client
sample_data/          Synthetic source and internal test workbooks
```

## Run locally

Prerequisites: Python 3.11+ and Node.js 20+.

```powershell
Copy-Item .env.example .env
py -3 -m venv .venv
.\.venv\Scripts\python -m pip install -e ".\backend[dev]"
.\.venv\Scripts\python -m uvicorn app.main:app --app-dir backend --reload
```

In a second terminal:

```powershell
Set-Location frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite development server proxies `/api` to FastAPI at <http://localhost:8000>.

Alternatively run `./start-dev.ps1` from PowerShell. The application works without an LLM for upload, mapping, policy defaults, deterministic reconciliation, governance, review, and export. The single canonical environment file is `.env` in the project root, regardless of the process working directory. Configure `OPENAI_API_KEY` and optionally `OPENAI_MODEL`; the same credential serves schema mapping, semantic analysis, Copilot wording, and Phase 8A investigation. `LLM_API_KEY` and `LLM_MODEL` remain accepted only as backwards-compatible aliases. Upload and export locations are configurable through `UPLOAD_DIR` and `EXPORT_DIR`.

## Test and build

```powershell
.\.venv\Scripts\python -m pytest backend
Set-Location frontend
npm run build
```

For one consolidated deterministic backend acceptance run (tests, frozen near-match evaluation, and the 10,000 × 10,500 synthetic benchmark):

```powershell
.\.venv\Scripts\python backend\scripts\evaluate_all.py
```

The benchmark writes `reports/phase7a_performance.json`. Its measurements describe this POC environment and are not a production SLA.

Ground Truth is only loaded inside the tests. Production application code does not read or reference it.

## API

- `POST /api/reconciliations`
- `POST /api/reconciliations/{id}/files/government`
- `POST /api/reconciliations/{id}/files/purchase-register`
- `POST /api/reconciliations/{id}/run/exact-match`
- `POST /api/reconciliations/{id}/mapping/analyze`
- `GET /api/reconciliations/{id}/mapping`
- `PUT /api/reconciliations/{id}/mapping`
- `POST /api/reconciliations/{id}/mapping/confirm`
- `POST /api/reconciliations/{id}/policy/propose`
- `GET /api/reconciliations/{id}/policy`
- `PUT /api/reconciliations/{id}/policy`
- `POST /api/reconciliations/{id}/policy/validate`
- `POST /api/reconciliations/{id}/policy/confirm`
- `POST /api/reconciliations/{id}/run/tolerance-match`
- `POST /api/reconciliations/{id}/near-match/analyze`
- `GET /api/reconciliations/{id}/near-match`
- `GET /api/reconciliations/{id}/near-match/summary`
- `POST /api/reconciliations/{id}/near-match/{candidate_id}/decision`
- `POST /api/reconciliations/{id}/near-match/bulk-approve`
- `GET /api/reconciliations/{id}/exceptions`
- `POST /api/reconciliations/{id}/exceptions/search`
- `GET /api/reconciliations/{id}/records/{record_id}`
- `GET /api/reconciliations/{id}/records/{record_id}/explanation`
- `GET /api/reconciliations/{id}/records/{record_id}/candidates`
- `POST /api/reconciliations/{id}/records/{record_id}/simulate-policy`
- `GET /api/reconciliations/{id}/exceptions/semantic-status`
- `POST /api/reconciliations/{id}/exceptions/semantic-analysis`
- `GET /api/reconciliations/{id}/exceptions/semantic-classifications`
- `POST /api/reconciliations/{id}/records/{record_id}/semantic-decision`
- `POST /api/reconciliations/{id}/ambiguous/{record_id}/select`
- `POST /api/reconciliations/{id}/copilot/messages`
- `GET /api/reconciliations/{id}/copilot/conversation`
- `GET /api/client-profiles`
- `POST /api/client-profiles/from-reconciliation/{reconciliation_id}`
- `GET /api/client-profiles/{profile_id}`
- `POST /api/client-profiles/{profile_id}/reconciliations`
- `POST /api/client-profiles/{profile_id}/reconciliations/{reconciliation_id}/compatibility`
- `GET /api/client-profiles/{profile_id}/rules`
- `POST /api/client-profiles/{profile_id}/rules`
- `GET /api/rules`
- `GET /api/rules/{rule_id}`
- `GET /api/rules/{rule_id}/history`
- `POST /api/rules/{rule_id}/simulate`
- `POST /api/rules/{rule_id}/approve`
- `POST /api/rules/{rule_id}/activate`
- `POST /api/rules/{rule_id}/disable`
- `POST /api/rules/{rule_id}/versions`
- `GET /api/reconciliations/{id}/patterns`
- `POST /api/reconciliations/{id}/patterns/detect`
- `POST /api/reconciliations/{id}/patterns/{pattern_id}/create-rule`
- `GET /api/reconciliations/{id}/results?status=TOLERANCE_MATCHED&offset=0&limit=500`
- `GET /api/schema/canonical-fields`
- `GET /api/reconciliations/{id}`
- `GET /api/reconciliations/{id}/summary`
- `GET /api/reconciliations/{id}/audit-events`
- `GET /api/reconciliations/{id}/final-review`
- `GET /api/reconciliations/{id}/exports`
- `POST /api/reconciliations/{id}/exports`
- `GET /api/reconciliations/{id}/exports/{export_id}/download`
- `GET /health`

OpenAPI documentation is available at <http://localhost:8000/docs> while the backend is running.

## Frozen product routes

The frontend is now a route-based workspace rather than a single long document. Primary destinations are `/overview`, `/reconciliations`, `/client-profiles`, `/rules`, and `/audit`. A reconciliation is restored at `/reconciliations/{id}/{stage}`, where `{stage}` is one of `setup`, `mapping`, `policy`, `results`, `near-matches`, `exceptions`, `audit`, or `final-review`.

The reconciliation id remains in the URL, so reload, browser back/forward, and shared local links preserve context. The most recent id is also retained locally as a recovery fallback. On smaller screens the primary sidebar becomes an accessible menu, the progress rail becomes horizontal, and data tables scroll within their own bounded regions.

## Optional real-provider mapping evaluation

The evaluation harness uses `LLM_PROVIDER` with the project-root `OPENAI_API_KEY` and `OPENAI_MODEL`. Expected JSON maps source column names to canonical names.

```powershell
.\.venv\Scripts\python backend\scripts\evaluate_schema_mapping.py `
  --workbook sample_data\POC_Government_GST_Aug2026.xlsx `
  --role government `
  --expected-json path\to\expected-government-mapping.json
```

Policy evaluation cases are a JSON array containing `instruction`, `expected_rules`, and
`should_validate`. The same command works with any configured `LLMProvider`:

```powershell
.\.venv\Scripts\python backend\scripts\evaluate_policy.py --cases path\to\policy-cases.json
```

Run the deterministic Phase 4 Ground Truth evaluation with:

```powershell
.\.venv\Scripts\python backend\scripts\evaluate_near_match.py `
  --government sample_data\POC_Government_GST_Aug2026.xlsx `
  --purchase-register sample_data\POC_Purchase_Register_Aug2026.xlsx `
  --ground-truth sample_data\POC_Reconciliation_Ground_Truth.xlsx
```

## Export security and lineage

Uploaded workbooks are treated as untrusted data. Only `.xlsx` is accepted; server paths use generated names, workbook formulas are never interpreted as instructions, and source workbooks are not modified. Exported text beginning with spreadsheet formula triggers is neutralized while numeric negatives remain numeric. Configuration and audit sheets exclude API keys, hidden prompts, and chain-of-thought.

Each export persists its reconciliation/profile/policy/export-profile lineage, state fingerprint, row count, file reference, version, creator, timestamp, and SHA-256. Upstream changes invalidate downstream reconciliation state through the existing repository rules. Previously generated files remain listed as historical and stale rather than being overwritten or deleted.

## Phase 8A — auditable AI exception investigation

Phase 8A adds one narrow OpenAI-backed investigation path for unresolved
`MATERIAL_MISMATCH`, `AMBIGUOUS`, `GST_ONLY`, and `PR_ONLY` records. It does not change
matching, tolerances, candidate generation, approvals, rules, or exports.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
AI_INVESTIGATION_TIMEOUT_SECONDS=45
AI_INVESTIGATION_MAX_TOOL_CALLS=8
```

The LangGraph workflow is: load scoped exception → OpenAI Responses API model/tool loop
→ structured conclusion → factual consistency validation → immutable persistence. The
five model-callable tools are read-only: `get_exception_context`, `compare_financials`,
`get_candidates`, `search_related_records`, and `get_governance_context`. Python remains
authoritative for financial facts.

The structured result includes a concise `reasoning_summary`, evidence references,
likely cause, recommendation, confidence, limitations, and missing-data flags. This is a
generated audit rationale based on tool evidence—not private chain-of-thought.
Unsupported critical numerical claims or uncited reasoning fail validation.

Each attempt persists provider/model/timestamps, token usage when returned, validation,
and a structured execution trace. Safe audit metadata uses
`AI_INVESTIGATION_STARTED`, `AI_TOOL_CALLED`, `AI_INVESTIGATION_COMPLETED`, and
`AI_INVESTIGATION_FAILED`; prompts, API keys, raw sensitive payloads, and hidden reasoning
are not logged. When `OPENAI_API_KEY` is absent, the feature reports unavailable and the
investigate endpoint returns `503`; it never fabricates an AI result.

- `GET /api/reconciliations/{id}/ai-investigation/status`
- `POST /api/reconciliations/{id}/records/{record_id}/ai-investigations`
- `GET /api/reconciliations/{id}/records/{record_id}/ai-investigations`
