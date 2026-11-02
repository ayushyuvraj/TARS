# TARS GST reconciliation demonstration

This guide runs the working POC through normal application routes and persisted backend state. It uses the synthetic August 2026 workbooks; it does not use a mock demo mode.

## Start

From the repository root:

```powershell
.\start-dev.ps1
```

Open <http://localhost:5173>. The deterministic path works without provider credentials. If no AI provider is configured, schema mapping and policy use the conservative local interpreter, exception evidence and Copilot remain deterministic, and semantic classification clearly reports that an AI provider is required.

Use these source files:

- `sample_data/POC_Government_GST_Aug2026.xlsx` — 1,000 Government records
- `sample_data/POC_Purchase_Register_Aug2026.xlsx` — 1,050 Purchase Register records

## Complete 18-step journey

1. Open **Reconciliations** and select **New reconciliation**.
2. Upload `POC_Government_GST_Aug2026.xlsx` as **Government GST / GSTR-2B**.
3. Upload `POC_Purchase_Register_Aug2026.xlsx` as **Purchase Register / ERP**.
4. Select **Analyze schemas**. Confirm that both files are profiled through the normal backend.
5. Review the proposed Schema Mapping and select **Confirm mapping**. The mappings must validate before the stage advances.
6. In Reconciliation Policy enter: `GSTIN and invoice number must match exactly. Allow ₹10 variance in taxable value and 5 days in invoice date.`
7. Generate and inspect the structured rules, then select **Confirm policy**. The policy revision and human-approval requirement remain visible.
8. Select **Run reconciliation**. Exact Match must report **520**.
9. The same run performs Tolerance Match and must report **140**.
10. Open **Near matches** and select **Analyze likely pairs**. Confirm **100** safe proposals and **40** ambiguous Government records.
11. Select **Approve all safe proposals**. The baseline becomes **760 resolved Government records**. No ambiguous record is selected automatically.
12. Open **Exceptions**. Confirm **40 Ambiguous**, **80 Material Mismatch**, **120 GST Only**, and **130 PR Only**. Also distinguish **240 remaining Government source records**, **290 remaining PR source records**, and **370 unresolved export outcome rows**.
13. Filter **Material mismatch** and open `GST-00761`. Its best candidate is `PR-00761`; the taxable-value variance is ₹5,000 against the confirmed ₹10 tolerance, with an IGST variance of ₹250 against ₹2.
14. With `GST-00761` selected, open **Copilot** and ask `Why wasn't this transaction matched?` Then ask `Simulate a taxable-value tolerance of ₹15,000. Would policy change?` Verify the response cites persisted variance evidence and states that the confirmed policy was not changed.
15. Filter **Ambiguous** and open `GST-00841`. Show `PR-00841` and `PR-00842`, their scores, and the small score gap. Leave the record unresolved; do not select a candidate for the frozen baseline.
16. Open **Rules**, select `R-001 Invoice separator normalization`, and show its persisted human-decision provenance and `PROPOSE_ONLY` authority. In Copilot ask `Why does the invoice separator normalization rule exist?` The grounded answer must refer to the 100 human-approved near matches and state that the rule cannot reconcile automatically.
17. Open **Audit**. Walk chronologically from creation and file profiling through mapping, policy confirmation, deterministic matching, candidate analysis, approval, Copilot tool calls, governance, and export. Select an event only when detailed metadata is needed.
18. Open **Final Review**. Verify the counts and export readiness, select **Generate Final Export**, then download the newest `.xlsx`. The export must contain 1,130 outcome rows and the five sheets listed below.

## Frozen count vocabulary

| Concept | Count |
| --- | ---: |
| Government source records | 1,000 |
| Purchase Register source records | 1,050 |
| Exact Match pairs | 520 |
| Tolerance Match pairs | 140 |
| Near Match pairs | 100 |
| Resolved Government records | 760 |
| Remaining Government source records | 240 |
| Remaining PR source records | 290 |
| Government unresolved outcome rows | 240 |
| PR-only outcome rows | 130 |
| Total unresolved outcome rows | 370 |
| Total final export outcome rows | 1,130 |

The final export is `760 resolved pair outcomes + 240 unresolved Government outcomes + 130 PR-only outcomes`. Do not add the two remaining-source counts together and call the result “open exceptions.”

## Export checks

The workbook must contain:

- `KIGS_Reconciliation` — header plus 1,130 outcomes, 57 configured POC fields
- `Summary` — source, match, exception, policy, export-profile, and export-ID metadata
- `Unresolved_Exceptions` — header plus 370 unresolved outcomes
- `Configuration` — confirmed mappings and policy
- `Audit_Summary` — persisted event lineage

The displayed export ID, version, SHA-256 integrity reference, row count, schema source, policy version, and stale/current state must match export history. A historical workbook remains downloadable after upstream state changes, but a new export is blocked until affected stages are rerun.

## Demo boundaries

- The workbook is KIGS-style and uses confirmed field evidence. It is not certified KIGS-compatible; formal compatibility requires the official machine-readable header/template and enum specification.
- `ReconciliationPercentage` remains blank because its official business semantics are unconfirmed.
- Optional model-backed semantic classification requires configured provider credentials. Do not imply that a real provider was evaluated when it was not.
- This is a working end-to-end POC with production-oriented architecture, not a production-ready, security-certified, tax-law-certified, or KIGS-certified system.

Reload and browser back/forward navigation are safe to demonstrate: the reconciliation ID and current stage are encoded in the route, and the Overview resumes the next persisted stage.

## Optional Phase 8A provider-backed sequence

Only demonstrate this when `OPENAI_API_KEY` is configured and the status endpoint reports
available. Otherwise, show the explicit unavailable message and continue with deterministic
exception evidence.

1. Open `GST-00761` in **Exceptions** and select **Investigate with AI**.
2. Show Likely Cause, Reasoning Summary, Evidence, Recommended Action, Confidence, and Limitations.
3. Expand **View Execution Trace** and show the ordered model/tool results and passed validation.
4. Investigate `GST-00841`; confirm it stays `AMBIGUOUS` and no candidate is selected.
5. With an exception selected, ask Copilot `Investigate this exception` to use the same flow.
6. In **Audit**, show the Phase 8A event sequence and confirm no prompt, secret, raw source
   payload, private chain-of-thought, or hidden reasoning was logged.
