# TARS Synthetic Reconciliation Dataset Generator

---

## 1. Overview & Purpose

The **TARS Synthetic Reconciliation Dataset Generator** (`scripts/generate_synthetic_recon_dataset.py`) is an on-demand, high-performance data synthesis engine designed to benchmark, stress-test, and audit TARS Reconciliation (Recon 4.0 and Recon 3.0).

It can synthesize datasets from **1 row up to 5,00,000 (5 lakh) rows** in seconds, injecting any exact or randomized combination of the 11 statutory and operational scenario types with 100% deterministic ground truth.

---

## 2. Supported Scenarios & Client Error Types

| Key | Scenario Name | Matching Tier | Expected TARS Verdict | Statutory / Audit Remark |
| :--- | :--- | :--- | :--- | :--- |
| `exact_match` | **Exact Statutory Identity** | Tier 1 | `Exact Match` | Zero variance across GSTIN, Invoice Number, Date, and ITC Financials |
| `commercial_tolerance` | **Commercial Value Tolerance (±₹10)** | Tier 2 | `Tolerance Match` | Minor penny / commercial difference absorbed under policy tolerance |
| `date_proximity` | **Document Date Proximity (±30 Days)** | Tier 2 | `Tolerance Match` | Document booked late due to operational dispatch delay (within allowable ±30-day window) |
| `cross_fy` | **Cross-Financial Year Boundary** | Tier 2 | `Tolerance Match` | Invoice dated in previous FY (March 31) and booked/received in subsequent FY (April 2) |
| `prefix_normalization` | **Document Number Normalization** | Tier 3 | `Near Match` | Invoice prefix/formatting dropped during manual booking (`INV/2026/` stripped to match internal reference) |
| `compound_variation` | **Compound Multi-Parameter Variation** | Tier 3 | `Near Match` | Simultaneous prefix formatting variation and document date delay |
| `ineligible_itc_17_5` | **Section 17(5) Ineligible ITC** | Tier 4 | `Ineligible ITC [Sec 17(5)]` | Full invoice reported in GSTR-2B; only eligible portion booked in PR (blocked credit u/s 17(5) excluded from PR) |
| `multi_tranche_banking` | **Banking Multi-Tranche N:1 Batch** | Tier 4 | `Consolidated Match` | Multiple supplier invoices consolidated into single PR voucher within rolling window (e.g. Bank charges / vendor tranche) |
| `ambiguous_collisions` | **Ambiguous Collisions** | Tier 5 | `Ambiguous` | Quarantined multi-candidate / duplicate invoice collision requiring accountant resolution |
| `gst_only` | **GSTR-2B Only** | Tier 5 | `GST Only` | Portal credit available but unrecorded in internal Purchase Register |
| `pr_only` | **Purchase Register Only** | Tier 5 | `PR Only` | Internal voucher present in books but missing from supplier return (DRC-01C risk) |

---

## 3. Designated Output Location & Generated Artifacts

Every run creates files in `data/synthetic_datasets/`:
1. **Data Workbook**:
   - `TARS_SYNTHETIC_<N>_ROWS_<TIMESTAMP>.csv` (Lightning-fast streaming format; recommended for $>50,000$ rows)
   - `TARS_SYNTHETIC_<N>_ROWS_<TIMESTAMP>.xlsx` (Sheet: `KIGS GSTR 2B Reco`, matching authoritative 165-column KIGS schema)
2. **Ground Truth JSON**:
   - `TARS_SYNTHETIC_<N>_ROWS_<TIMESTAMP>_ground_truth.json` containing exact counts, proportions, and configuration parameters.
3. **Executive Summary Table**:
   - `TARS_SYNTHETIC_<N>_ROWS_<TIMESTAMP>_summary.md` with a clean markdown table of the distribution ready to copy and tally against TARS results.

---

## 4. Usage Instructions

### Command Line Interface

```bash
# Example 1: Generate 100,000 rows with randomized realistic proportions
.venv\Scripts\python.exe scripts/generate_synthetic_recon_dataset.py --rows 100000 --csv-only

# Example 2: Generate 100,000 rows with exact user-specified scenario counts
.venv\Scripts\python.exe scripts/generate_synthetic_recon_dataset.py \
    --rows 100000 \
    --exact 14234 \
    --tolerance 50000 \
    --multi-tranche 345 \
    --ineligible-itc 5000 \
    --csv-only \
    --validate

# Example 3: Generate 25,000 rows in Excel (.xlsx) format
.venv\Scripts\python.exe scripts/generate_synthetic_recon_dataset.py --rows 25000 --xlsx-only
```

### Supported CLI Flags

- `--rows <N>`: Total rows to generate ($1 \le N \le 500,000$).
- `--randomize`: Dynamically randomizes scenario counts and proportions ensuring every category is populated.
- `--seed <int>`: Optional random seed for deterministic reproduction (defaults to random when `--randomize` is set).
- `--exact <count>`: Exact count of Direct Exact Matches.
- `--tolerance <count>`: Exact count of Commercial Value Tolerance Matches.
- `--date-prox <count>`: Exact count of Date Proximity Matches (±30d).
- `--cross-fy <count>`: Exact count of Cross-Financial Year Matches (March/April).
- `--prefix <count>`: Exact count of Prefix Normalization Matches.
- `--compound <count>`: Exact count of Compound Variations.
- `--ineligible-itc <count>`: Exact count of Section 17(5) Ineligible ITC.
- `--multi-tranche <count>`: Exact count of Multi-Tranche Banking Entries.
- `--ambiguous <count>`: Exact count of Ambiguous Duplicate Collisions.
- `--gst-only <count>`: Exact count of GSTR-2B Only Unclaimed Credits.
- `--pr-only <count>`: Exact count of PR Only Books Vouchers.
- `--csv-only`: Generates only CSV (recommended for $\ge 50,000$ rows).
- `--xlsx-only`: Generates only Excel (.xlsx with sheet `KIGS GSTR 2B Reco`).
- `--validate`: Automatically executes the generated dataset against `WaterfallMatchingEngineV4` and prints an immediate tally comparison.

---

## 5. Performance Benchmarks

- **10,000 rows**: Generation in **0.38s**, CSV write in **0.47s**, TARS matching in **1.45s**.
- **100,000 rows**: Generation in **3.93s**, CSV write in **5.12s**, TARS matching in **2.79s**.
- **500,000 rows**: Generation in **~18s**, CSV write in **~22s**, TARS matching in **~12s**.
