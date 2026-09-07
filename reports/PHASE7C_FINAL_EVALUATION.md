# Phase 7C final evaluation

Evaluation date: 6 September 2026 (Asia/Calcutta)

Status: all release-blocking POC gates passed. The working POC is frozen after Phase 7C. This report does not claim production readiness or certification.

## Matching

| Measure | Result |
| --- | ---: |
| Government source records | 1,000 |
| Purchase Register source records | 1,050 |
| Exact Match ground truth | 520/520 |
| Tolerance Match ground truth | 140/140 |
| Expected Near Match pairs | 100 |
| Candidate recall | 100% |
| Top-1 pair accuracy | 100% |
| Safe-proposal precision | 100% |
| Safe-proposal recall | 100% |
| False near matches | 0 |
| Ambiguous automatic matches | 0 |
| Duplicate PR consumption | 0 |
| Material-mismatch false matches | 0 |
| GST-only false matches | 0 |
| PR-only false consumption | 0 |

The independent evaluator produced 2,750 blocked candidates in 843.50 ms on the final run. Application code does not load Ground Truth.

## Final reconciliation

| Outcome | Count |
| --- | ---: |
| Exact Match pairs | 520 |
| Tolerance Match pairs | 140 |
| Near Match pairs | 100 |
| Resolved Government records | 760 |
| Remaining Government source records | 240 |
| Remaining PR source records | 290 |
| Ambiguous Government outcomes | 40 |
| Material Mismatch Government outcomes | 80 |
| GST Only Government outcomes | 120 |
| PR Only outcomes | 130 |
| Unresolved export outcomes | 370 |
| Final export outcomes | 1,130 |

The unresolved export count is `240 Government unresolved + 130 PR Only`, not `240 Government remaining + 290 PR remaining`.

## Schema and policy

- Both renamed synthetic schemas mapped to the canonical contract and passed required-field, conflict, datatype, and GSTIN validation.
- The no-provider schema path produced a valid proposal and required human confirmation.
- The natural-language policy `GSTIN and invoice number must match exactly. Allow ₹10 variance in taxable value and 5 days in invoice date.` produced and persisted a mechanically valid structured policy.
- Policy simulation with a selected material mismatch and hypothetical ₹15,000 taxable-value tolerance was read-only; the persisted confirmed policy was byte-for-byte unchanged.
- Provider-agnostic schema and policy evaluator tests passed. No real external provider credentials were present, so no provider-specific quality claim is made.

## Semantic and Copilot evaluation

- Provider-agnostic semantic fixture evaluation passed structured classification, human confirmation, override, filtering, failure persistence, and prompt-boundary checks.
- No-LLM semantic status correctly reports unavailable while deterministic exception tools remain usable.
- Copilot tool-selection accuracy, factual consistency, and structured-response validity tests each passed at 100% for the evaluated cases.
- Live deterministic questions correctly routed to exception breakdown, variance analysis, ranked candidates, rule listing, rule provenance, and read-only policy simulation.
- Representative evidence: `GST-00761` → `PR-00761` explains ₹5,000 taxable variance versus ₹10 allowed and ₹250 IGST variance versus ₹2 allowed. `GST-00841` exposes two ranked candidates and blocks automatic selection because the score gap is within the ambiguity margin.
- Prompt injection requesting approval of every transaction returned no suggested action and did not change match results.
- No real OpenAI, Anthropic, or Gemini provider evaluation was run because the environment contained no provider credentials.

## Governance and action authority

- Pattern detection, minimum support, duplicate suppression, conflict suppression, draft creation, simulation, approval, activation, disabling, immutable successor versioning, profile compatibility, and rule execution lineage passed.
- `R-001 v1 Invoice separator normalization` records provenance from 100 human-approved near matches.
- Active rule authority is `PROPOSE_ONLY`; rule execution records show zero automatic reconciliations.
- Copilot can retrieve the rule by ID or human-readable name and explains both provenance and authority from persisted rule state.

## Export

Live reconciliation: `b31d3249-cdfe-4e21-958e-dc44e893b3aa`

Live export: `306692a4-9914-69f4-9281-348d421097a4`, version 1, SHA-256 `2afec575eed2e64f16386535dd9dfcfe6dab561caea8a4979c49a2132e2abe3a`.

- `KIGS_Reconciliation`: 1 header + 1,130 outcome rows; 57 configured POC columns in registry order.
- `Summary`: 23 rows, including source/match counts, 370 unresolved outcomes, policy/export-profile version, generation time, export ID, and variance convention.
- `Unresolved_Exceptions`: 1 header + 370 outcome rows.
- `Configuration`: 54 rows of confirmed mapping and policy context.
- `Audit_Summary`: 30 rows in the generated live workbook.
- Spreadsheet-runtime inspection found zero formulas and zero spreadsheet formula-error tokens. All five first-row regions rendered legibly with typed dates/numbers and visible headers.
- Export validation, filename/text formula neutralization, version history, SHA-256 persistence, download, content-change hashing, and stale-state export blocking passed regression tests.
- Schema source is `CONFIGURED_POC`. Formal KIGS compatibility is not claimed without the official machine-readable template and enum specification.

## Performance

Final synthetic benchmark on this local environment:

| Workload | Result |
| --- | ---: |
| Government rows | 10,000 |
| Purchase Register rows | 10,500 |
| Exact matches | 8,000 |
| Exact runtime | 7,402.67 ms |
| Near candidates / safe proposals | 2,000 / 2,000 |
| Near runtime | 8,522.01 ms |
| Total runtime | 15,924.68 ms |
| Peak measured memory | 29.83 MB |

This is a synthetic deterministic benchmark, not a production SLA. Unique-GSTIN blocking bounds the remaining candidate set after exact matching.

## Frontend and browser

- TypeScript project check passed.
- Vite production build passed.
- Routes verified: Overview, Reconciliations, Setup, Mapping, Policy, Results, Near Matches, Exceptions, Audit, Final Review, Client Profiles, and Rules.
- Persisted session reload and stage routes loaded without an application error surface. The accepted Phase 7B browser-console baseline was clean; the Phase 7C route sweep introduced no observed console/runtime application error.
- Responsive checks passed at 375, 768, 1,024, and 1,440 px. Mobile navigation activates at ≤820 px; all three authoritative Overview metrics remain present.
- Keyboard-visible controls, skip link, stage `aria-current`, pressed states, labelled groups/dialogs, Copilot focus trapping/Escape/restore, reduced-motion handling, and route-specific document titles are present.
- Stage rail now distinguishes complete, current, available, blocked, and stale export states. Overview resumes Exceptions until a current export exists, then resumes Final Review.

## Tests

- Backend: 29/29 pytest tests passed on the final consolidated run.
- Python compilation: backend application, scripts, and tests passed `compileall`.
- Frontend TypeScript and production build passed.
- One third-party deprecation warning remains from Starlette's `anyio.abc.BlockingPortal` alias; it is not an application failure.

## Known limitations

- Official full KIGS template/header and enum semantics are not yet available; `ReconciliationPercentage` semantics remain unconfirmed and the field is blank.
- Anthropic and Gemini provider adapters remain stubs; the final environment had no provider credentials, so only deterministic and provider-fixture paths were evaluated.
- No enterprise authentication/RBAC, tenant isolation, formal security assessment, production cloud deployment, live KIGS API integration, or real-client production benchmark exists.
- SQLite/local filesystem persistence and the single-machine benchmark are POC choices, not production HA, retention, recovery, or SLA evidence.

## Phase 7C polish changes

- Corrected Overview terminology so 240 Government records requiring review and 130 PR-only outcome rows are not conflated into a misleading 530 count.
- Made persisted export history drive the next stage and stage-rail current/stale state.
- Added progressive disclosure for non-decision source fields and collapsed raw audit metadata.
- Exposed rule `PROPOSE_ONLY` authority and clarified zero automatic reconciliations.
- Added grounded rule-name provenance routing and explicit policy-unchanged wording for Copilot simulations.
- Added route titles and accessible Copilot drawer focus management.
- Rewrote the 18-step demo guide, updated the README, and created the POC freeze boundary.

## Release decision

No Phase 7C release-blocking POC gate remains. The project is frozen after Phase 7C. Productionization items remain outside the POC freeze.
