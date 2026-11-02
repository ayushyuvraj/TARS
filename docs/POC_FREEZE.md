# TARS GST Agentic Reconciliation Workbench — POC freeze

## Status

**Frozen after Phase 7C on 6 September 2026.** This is a working end-to-end POC with a production-oriented architecture. Changes after this point should be limited to release-blocking defects, dependency/security maintenance, or explicitly approved productionization work.

## Included

- Real `.xlsx` upload, profiling, Schema Mapping, Reconciliation Policy, Exact Match, Tolerance Match, Near Match, exception investigation, Copilot, Client Profiles, governed Rules, Audit, Final Review, and versioned KIGS-style export.
- Persisted reconciliation, human-approval, candidate, semantic-review, governance, conversation, audit, and export lineage in SQLite.
- Deterministic financial matching with one-to-one Purchase Register consumption.
- Optional provider-backed interpretation/classification behind a replaceable provider contract; a conservative no-provider path remains available.
- Five-sheet export with configured KIGS POC field structure, validation, SHA-256 integrity reference, history, and stale-state handling.

## Verified frozen baseline

- Source rows: Government 1,000; Purchase Register 1,050.
- Pair outcomes: Exact 520; Tolerance 140; Near 100.
- Accuracy: 100/100 expected near pairs retrieved at rank 1; zero false near matches; zero duplicate PR consumption; zero ambiguous auto-selections.
- Final state: 760 resolved Government records; 240 remaining Government source records; 290 remaining PR source records.
- Export: 370 unresolved outcomes and 1,130 total outcomes across five worksheets.
- Governance: active rules have `PROPOSE_ONLY` authority and create zero automatic reconciliations.
- Safety: formula-injection neutralization, prompt-injection no-action behavior, stale-export blocking, upload validation, and filename sanitization are regression-tested.
- Frontend: TypeScript, production build, route restoration, responsive layouts, keyboard focus, and accessible labels are checked.

The consolidated evidence is in [reports/PHASE7C_FINAL_EVALUATION.md](reports/PHASE7C_FINAL_EVALUATION.md). The reproducible presentation flow is in [DEMO.md](DEMO.md).

## Architecture principles

- Python services and persisted structured contracts remain the source of financial truth.
- Models may interpret or communicate, but deterministic tools establish financial facts.
- Consequential mappings, policy, ambiguous selections, and reusable automation remain human-governed.
- Rules carry provenance, immutable versions, simulations, approval state, and explicit action authority.
- Every material transition produces an audit event; exports capture the state and configuration versions that created them.
- Provider-specific SDK code stays behind the provider boundary and does not enter matching, policy semantics, governance, export, or frontend code.

## Known limitations

- The official full KIGS machine-readable template has not been supplied; formal field order and enum semantics are not completely verified.
- Official `ReconciliationPercentage` semantics are unconfirmed, so the POC leaves it blank.
- Anthropic and Gemini adapters remain stubs; no real external provider evaluation was run in the frozen environment.
- There is no enterprise authentication, RBAC, formal security assessment, production cloud deployment, or live KIGS API integration.
- SQLite and local file storage are POC persistence choices, not a production HA/backup/retention design.
- Performance evidence uses synthetic data on one local environment, not real client production datasets or a production SLA.

## Explicitly not productionized

This freeze does not claim production readiness, production certification, security certification, KIGS certification, or tax-law certification. Operational controls still needed include enterprise identity and authorization, tenant isolation, secrets management, managed storage/database, observability, backup and disaster recovery, retention policies, threat modeling and penetration testing, privacy/legal review, deployment automation, and live-system integration controls.

## Possible productionization work

- Validate the adapter against the official KIGS header/template and enumerations.
- Complete and independently evaluate each chosen model-provider adapter.
- Add enterprise identity, role separation, tenant isolation, approval policy, and audit retention controls.
- Move state and files to managed production services with encryption, backups, recovery tests, monitoring, and capacity testing.
- Benchmark with representative client datasets and agree service-level objectives.
- Complete formal security, privacy, tax-domain, and operational reviews before any live use.
