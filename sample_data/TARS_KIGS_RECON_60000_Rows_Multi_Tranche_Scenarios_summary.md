# Synthetic Dataset Ground Truth Breakdown

- **Filename Base**: `TARS_KIGS_RECON_60000_Rows_Multi_Tranche_Scenarios`
- **Total Records**: 60,000
- **Generation Time**: 2.30s
- **Generated At**: 2026-10-12T08:49:57.593631+00:00

| Scenario Key | Scenario Name | Section Bucket | Tier | Row Count | Proportion | Statutory Audit Comment |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `exact_match` | **Exact Statutory Identity** | `Exact Match` | Tier 1: Exact Match (Zero Variance) | **20,198** | 33.66% | Exact Statutory Identity: Zero variance across GSTIN, Invoice Number, Date, and ITC Financials |
| `commercial_tolerance` | **Commercial Value Tolerance (±₹10)** | `Tolerance Match` | Tier 2: Commercial Tolerances & Cross-FY | **8,653** | 14.42% | Commercial Tolerance Match: Financial variance within allowable policy tolerance |
| `date_proximity` | **Document Date Proximity (±30 Days)** | `Tolerance Match` | Tier 2: Commercial Tolerances & Cross-FY | **5,769** | 9.62% | Document Date Proximity: Document booked late due to operational dispatch delay (within allowable ±30-day window) |
| `cross_fy` | **Cross-Financial Year Boundary (March 31 vs April 2)** | `Tolerance Match` | Tier 2: Commercial Tolerances & Cross-FY | **2,884** | 4.81% | Cross-Financial Year Boundary Timing Difference: Invoice dated in previous FY (March 31) and booked/received in subsequent FY (April 2) |
| `prefix_normalization` | **Document Number Prefix Normalization** | `Near Match` | Tier 3: Normalized & Compound Matches | **3,461** | 5.77% | Document Number Normalization: Invoice prefix/formatting dropped during manual booking ('INV/2026/' stripped to match internal reference) |
| `compound_variation` | **Compound Multi-Parameter Variation** | `Near Match` | Tier 3: Normalized & Compound Matches | **2,884** | 4.81% | Compound Variation Match: Simultaneous prefix formatting variation and document date delay |
| `ineligible_itc_17_5` | **Section 17(5) Ineligible ITC / Blocked Credit** | `Ineligible ITC [Sec 17(5)]` | Tier 4: Statutory Discrepancies & Batches | **2,884** | 4.81% | Section 17(5) Ineligible ITC / Rejected Goods: Full invoice reported in GSTR-2B; only eligible portion booked in PR (ineligible/blocked credit u/s 17(5) not booked in books) |
| `multi_tranche_banking` | **Banking & Multi-Tranche Batch (N:1 & 1:N) Consolidation** | `Consolidated Match` | Tier 4: Statutory Discrepancies & Batches | **3,461** | 5.77% | Consolidated Multi-Tranche Entry: Multiple supplier invoices consolidated into single PR voucher within rolling window (e.g. Bank charges / vendor tranche) |
| `ambiguous_collisions` | **Ambiguous Duplicate Collisions** | `Ambiguous` | Tier 5: Single-Sided Residuals & Ambiguities | **4,038** | 6.73% | Ambiguity / Tolerance Collision: Quarantined for review |
| `gst_only` | **GSTR-2B Only (Unclaimed Portal Credit)** | `GST Only` | Tier 5: Single-Sided Residuals & Ambiguities | **2,884** | 4.81% | Portal Credit Available (Unrecorded in Books): Supplier filed in GSTR-1/2B but voucher missing or not entered in Purchase Register |
| `pr_only` | **Purchase Register (Books) Only (Missing in 2B)** | `PR Only` | Tier 5: Single-Sided Residuals & Ambiguities | **2,884** | 4.81% | Internal Books Voucher Only (Unmatched in Portal): Missing in GSTR-2B; DRC-01C compliance notice risk if claimed without vendor filing |

---
*Ready to ingest directly into TARS Reconciliation 4.0 or 3.0.*
