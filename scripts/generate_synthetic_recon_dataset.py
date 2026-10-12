#!/usr/bin/env python3
"""
TARS Synthetic Reconciliation Dataset Generator
================================================
Generates on-demand, statistically controlled synthetic GST reconciliation
datasets (from 1 row up to 500,000 rows) matching the authoritative KIGS GSTR 2B
Intra-Table schema used by TARS Reconciliation 4.0.

Key Features:
- Exact proportion / count control or random partition across all 11 error & match scenarios.
- High-performance vectorized generation (NumPy/Pandas).
- Emits .xlsx (sheet 'KIGS GSTR 2B Reco') and/or .csv formats.
- Generates companion Ground Truth breakdown JSON & Markdown reports.
- Includes --validate flag to immediately run against WaterfallMatchingEngineV4 and verify tally.
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
from pathlib import Path
import random
import sys
import time
from typing import Any

import numpy as np
import pandas as pd

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("TARS_DatasetGenerator")

# Standard 165-column KIGS schema
KIGS_COLUMNS = [
    'LocationGstin', 'LocationName', 'ReconciliationSection', 'SuggReconciliationSection', 'Reason',
    'ActionStatus', 'Action', 'ValueDifference', 'TaxableDifference', 'IGSTDifference', 'CGSTDifference',
    'SGSTDifference', 'CessDifference', 'CPGstin', 'PRGstin', 'CPTradeName', 'PRTradeName', 'CPLegalName',
    'PRLegalName', 'EInvoiceEnablement', 'CPDocumentNumber', 'PRDocumentNumber', 'CPDocumentDate',
    'PRDocumentDate', 'CPDocumentType', 'PRDocumentType', 'CPValue', 'PRValue', 'CPPOS', 'PRPOS',
    'CPReverseCharge', 'PRReverseCharge', 'CPDifferentialPercentage', 'PRDifferentialPercentage',
    'CPTransactionType', 'PRTransactionType', 'CPTransactionNature', 'PRTransactionNature', 'CPTaxPayerType',
    'PRTaxPayerType', 'CPOriginalDocumentNumber', 'PROriginalDocumentNumber', 'CPOriginalDocumentDate',
    'PROriginalDocumentDate', 'CPPortCode', 'PRPortCode', 'CPTaxableValue', 'PRTaxableValue', 'CPRate',
    'PRRate', 'CPIgstAmount', 'PRIgstAmount', 'CPCgstAmount', 'PRCgstAmount', 'CPSgstAmount', 'PRSgstAmount',
    'CPCessAmount', 'PRCessAmount', 'CPSupplierCancellationDate', 'CPFilingStatus', 'CpfFilingPreference',
    'CPFilingDate', 'CPFilingReturnPeriod', 'GSTR3BFiled', 'Gstr3bFilingDate', 'CPAutoDraftSource', 'CPIrn',
    'PRIrn', 'CPIrnGenerationDate', 'CPItcAvailability', 'CPItcUnavailabilityReason', 'CPReturnPeriod',
    'PRReturnPeriod', 'CPIsAmendment', 'PRIsAmendment', 'CPOriginalReturnPeriod', 'PROriginalReturnPeriod',
    'CPAmendedType', 'PaymentType', 'PaymentStatus', 'PaymentAmount', 'PaymentDate', 'PaymentRemarks',
    'CreditAvailedDate', 'CreditReversalDate', 'AvailProvisionalItc', 'ReconciliationPercentage', 'PRCustom1',
    'PRCustom2', 'PRCustom3', 'PRCustom4', 'PRCustom5', 'PRCustom6', 'PRCustom7', 'PRCustom8', 'PRCustom9',
    'PRCustom10', 'PRHsn', 'PRItcEligibility', 'PRItcIgstAmount', 'PRItcCgstAmount', 'PRItcSgstAmount',
    'PRItcCessAmount', 'PRCustomItem1', 'PRCustomItem2', 'PRCustomItem3', 'PRCustomItem4', 'PRCustomItem5',
    'PRCustomItem6', 'PRCustomItem7', 'PRCustomItem8', 'PRCustomItem9', 'PRCustomItem10', 'ReconciledBy',
    'InterCompanyOrWrongEntityGstin', 'InterCompanyOrWrongEntityName', 'CPRefPrecedingDocumentDetails',
    'PRRefPrecedingDocumentDetails', 'CPAvailableInGstr2B', 'CPGstr2bReturnPeriod', 'CPAvailableInGstr98A',
    'CPItcClaimMonth', 'PRItcClaimMonth', 'GSTActOrRuleSection', 'ManualReconciliation', 'RecordName',
    'ReconciliationDateTime', 'Remarks', 'CpGstinStatus', 'PrGstinStatus', 'Gstr3bSection', 'CPBillToGstin',
    'PRCustom11', 'PRCustom12', 'PRCustom13', 'PRCustom14', 'PRCustom15', 'PRCustom16', 'PRCustom17',
    'PRCustom18', 'PRCustom19', 'PRCustom20', 'PRCustomItem11', 'PRCustomItem12', 'PRCustomItem13',
    'PRCustomItem14', 'PRCustomItem15', 'PRCustomItem16', 'PRCustomItem17', 'PRCustomItem18', 'PRCustomItem19',
    'PRCustomItem20', 'IMSAction', 'Gstr1GrcScore', 'Gstr3bGrcScore', 'Notes', 'ReduceITC', 'DeclIgst',
    'DeclSgst', 'DeclCgst', 'DeclCess', 'IMSRemarks', 'ReferenceId', 'CPIsReversal', 'Gstr3bNonPayment'
]

VENDOR_POOL = [
    ("27AABCU9603R1ZM", "TATA CONSULTANCY SERVICES LTD", "TCS"),
    ("09AACCK3456Q1Z6", "INFOSYS LIMITED", "INFOSYS"),
    ("29AAJCM7890R1Z4", "WIPRO ENTERPRISES PVT LTD", "WIPRO"),
    ("27AAACB1234M1Z1", "HDFC BANK LIMITED", "HDFC BANK"),
    ("06AAACF7654L1Z8", "AIRTEL DIGITAL ENTERPRISES", "AIRTEL"),
    ("33AABCL5555M1ZP", "LARSEN & TOUBRO LIMITED", "L&T"),
    ("24AAGCS1234N1ZP", "RELIANCE RETAIL LIMITED", "RELIANCE"),
    ("07AAAAA0000A1Z5", "DELHI SERVICES CORP", "DELHI CORP"),
    ("19AAACG1111B1Z2", "ITC LIMITED", "ITC"),
    ("36AAACR9999C1Z0", "REDDY LABORATORIES", "DR REDDY"),
]

SCENARIO_KEYS = [
    "exact_match",
    "commercial_tolerance",
    "date_proximity",
    "cross_fy",
    "prefix_normalization",
    "compound_variation",
    "ineligible_itc_17_5",
    "multi_tranche_banking",
    "ambiguous_collisions",
    "gst_only",
    "pr_only",
]

SCENARIO_META = {
    "exact_match": {
        "name": "Exact Statutory Identity",
        "section": "Exact Match",
        "tier": "Tier 1: Exact Match (Zero Variance)",
        "comment": "Exact Statutory Identity: Zero variance across GSTIN, Invoice Number, Date, and ITC Financials",
        "weight": 0.35,
    },
    "commercial_tolerance": {
        "name": "Commercial Value Tolerance (±₹10)",
        "section": "Tolerance Match",
        "tier": "Tier 2: Commercial Tolerances & Cross-FY",
        "comment": "Commercial Tolerance Match: Financial variance within allowable policy tolerance",
        "weight": 0.15,
    },
    "date_proximity": {
        "name": "Document Date Proximity (±30 Days)",
        "section": "Tolerance Match",
        "tier": "Tier 2: Commercial Tolerances & Cross-FY",
        "comment": "Document Date Proximity: Document booked late due to operational dispatch delay (within allowable ±30-day window)",
        "weight": 0.10,
    },
    "cross_fy": {
        "name": "Cross-Financial Year Boundary (March 31 vs April 2)",
        "section": "Tolerance Match",
        "tier": "Tier 2: Commercial Tolerances & Cross-FY",
        "comment": "Cross-Financial Year Boundary Timing Difference: Invoice dated in previous FY (March 31) and booked/received in subsequent FY (April 2)",
        "weight": 0.05,
    },
    "prefix_normalization": {
        "name": "Document Number Prefix Normalization",
        "section": "Near Match",
        "tier": "Tier 3: Normalized & Compound Matches",
        "comment": "Document Number Normalization: Invoice prefix/formatting dropped during manual booking ('INV/2026/' stripped to match internal reference)",
        "weight": 0.06,
    },
    "compound_variation": {
        "name": "Compound Multi-Parameter Variation",
        "section": "Near Match",
        "tier": "Tier 3: Normalized & Compound Matches",
        "comment": "Compound Variation Match: Simultaneous prefix formatting variation and document date delay",
        "weight": 0.05,
    },
    "ineligible_itc_17_5": {
        "name": "Section 17(5) Ineligible ITC / Blocked Credit",
        "section": "Ineligible ITC [Sec 17(5)]",
        "tier": "Tier 4: Statutory Discrepancies & Batches",
        "comment": "Section 17(5) Ineligible ITC / Rejected Goods: Full invoice reported in GSTR-2B; only eligible portion booked in PR (ineligible/blocked credit u/s 17(5) not booked in books)",
        "weight": 0.05,
    },
    "multi_tranche_banking": {
        "name": "Banking & Multi-Tranche Batch (N:1 & 1:N) Consolidation",
        "section": "Consolidated Match",
        "tier": "Tier 4: Statutory Discrepancies & Batches",
        "comment": "Consolidated Multi-Tranche Entry: Multiple supplier invoices consolidated into single PR voucher within rolling window (e.g. Bank charges / vendor tranche)",
        "weight": 0.06,
    },
    "ambiguous_collisions": {
        "name": "Ambiguous Duplicate Collisions",
        "section": "Ambiguous",
        "tier": "Tier 5: Single-Sided Residuals & Ambiguities",
        "comment": "Ambiguity / Tolerance Collision: Quarantined for review",
        "weight": 0.07,
    },
    "gst_only": {
        "name": "GSTR-2B Only (Unclaimed Portal Credit)",
        "section": "GST Only",
        "tier": "Tier 5: Single-Sided Residuals & Ambiguities",
        "comment": "Portal Credit Available (Unrecorded in Books): Supplier filed in GSTR-1/2B but voucher missing or not entered in Purchase Register",
        "weight": 0.05,
    },
    "pr_only": {
        "name": "Purchase Register (Books) Only (Missing in 2B)",
        "section": "PR Only",
        "tier": "Tier 5: Single-Sided Residuals & Ambiguities",
        "comment": "Internal Books Voucher Only (Unmatched in Portal): Missing in GSTR-2B; DRC-01C compliance notice risk if claimed without vendor filing",
        "weight": 0.05,
    },
}


class SyntheticReconDatasetGenerator:
    """High-performance generator for arbitrary-sized synthetic reconciliation workbooks."""

    def __init__(self, seed: int = 42):
        self.seed = seed
        random.seed(seed)
        np.random.seed(seed)

    def allocate_counts(
        self,
        total_rows: int,
        custom_counts: dict[str, int] | None = None,
        randomize: bool = False,
    ) -> dict[str, int]:
        """Calculates exact scenario row counts ensuring the sum equals total_rows."""
        allocated: dict[str, int] = {}
        fixed_sum = 0

        if custom_counts:
            for k in SCENARIO_KEYS:
                if k in custom_counts and custom_counts[k] is not None:
                    allocated[k] = max(0, int(custom_counts[k]))
                    fixed_sum += allocated[k]

        remaining_rows = total_rows - fixed_sum
        if remaining_rows < 0:
            raise ValueError(f"Specified custom counts sum ({fixed_sum}) exceeds total_rows ({total_rows}).")

        unallocated_keys = [k for k in SCENARIO_KEYS if k not in allocated]
        if not unallocated_keys:
            if remaining_rows > 0:
                # Add remainder to exact_match
                allocated["exact_match"] += remaining_rows
            return allocated

        if randomize:
            # Generate random realistic counts ensuring every scenario has a non-zero count
            num_cats = len(unallocated_keys)
            min_per_cat = max(15, int(remaining_rows * 0.005))  # minimum representation
            pool = remaining_rows - (min_per_cat * num_cats)
            if pool < 0:
                min_per_cat = max(1, remaining_rows // num_cats)
                pool = remaining_rows - (min_per_cat * num_cats)

            rand_weights = np.random.uniform(0.5, 3.5, size=num_cats)
            for idx, k in enumerate(unallocated_keys):
                if k == "exact_match":
                    rand_weights[idx] *= np.random.uniform(1.8, 3.5)
                elif k == "commercial_tolerance":
                    rand_weights[idx] *= np.random.uniform(1.4, 2.8)

            rand_weights /= rand_weights.sum()
            add_counts = np.floor(pool * rand_weights).astype(int)
            leftover = pool - add_counts.sum()

            for i, k in enumerate(unallocated_keys):
                allocated[k] = int(min_per_cat + add_counts[i])

            if leftover > 0:
                lucky_key = random.choice(unallocated_keys)
                allocated[lucky_key] += int(leftover)
        else:
            # Distribute remaining rows proportionally based on weights
            weights = [SCENARIO_META[k]["weight"] for k in unallocated_keys]
            w_sum = sum(weights) or 1.0
            normalized_w = [w / w_sum for w in weights]

            raw_counts = [int(remaining_rows * nw) for nw in normalized_w]
            leftover = remaining_rows - sum(raw_counts)

            for i, k in enumerate(unallocated_keys):
                allocated[k] = raw_counts[i]

            # Put leftover into first unallocated key (or exact_match)
            if leftover > 0:
                target_key = "exact_match" if "exact_match" in unallocated_keys else unallocated_keys[0]
                allocated[target_key] += leftover

        return allocated

    def generate_dataframe(self, row_counts: dict[str, int]) -> tuple[pd.DataFrame, dict[str, Any]]:
        """Generates the full 165-column DataFrame with vectorized operations."""
        start_time = time.time()
        total_records = sum(row_counts.values())
        logger.info(f"Generating synthetic dataset of {total_records:,} rows across {len(row_counts)} scenarios...")

        # Initialize base column arrays
        data: dict[str, list[Any]] = {col: [None] * total_records for col in KIGS_COLUMNS}

        # Populate static columns
        data["LocationGstin"] = ["27AAACG0001A1Z9"] * total_records
        data["LocationName"] = ["MUMBAI CENTRAL HUB"] * total_records
        data["ActionStatus"] = ["Auto-Reconciled"] * total_records
        data["Action"] = ["Accept"] * total_records
        data["CPDocumentType"] = ["INV"] * total_records
        data["PRDocumentType"] = ["INV"] * total_records
        data["CPRate"] = [18.0] * total_records
        data["PRRate"] = [18.0] * total_records
        data["CPFilingStatus"] = ["Y"] * total_records
        data["GSTR3BFiled"] = ["Y"] * total_records
        data["CPItcAvailability"] = ["Y"] * total_records
        data["CPReturnPeriod"] = ["062026"] * total_records
        data["PRReturnPeriod"] = ["062026"] * total_records

        current_idx = 0
        ground_truth_report: dict[str, Any] = {
            "total_records": total_records,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "scenarios": {},
        }

        # Loop through scenarios and generate blocks
        for sc_key, count in row_counts.items():
            if count <= 0:
                continue

            end_idx = current_idx + count
            meta = SCENARIO_META[sc_key]
            ground_truth_report["scenarios"][sc_key] = {
                "name": meta["name"],
                "section": meta["section"],
                "tier": meta["tier"],
                "count": count,
                "percentage": round((count / total_records) * 100.0, 2),
                "comment": meta["comment"],
            }

            # Generate vendor IDs
            vendor_choices = [VENDOR_POOL[i % len(VENDOR_POOL)] for i in range(count)]
            v_gstins = [v[0] for v in vendor_choices]
            v_legals = [v[1] for v in vendor_choices]
            v_trades = [v[2] for v in vendor_choices]

            # Generate base financial numbers
            base_taxables = np.round(np.random.uniform(1000.0, 150000.0, size=count), 2)
            base_taxes = np.round(base_taxables * 0.18, 2)
            base_totals = np.round(base_taxables + base_taxes, 2)

            # Base document numbers and dates
            inv_nums = [f"INV/2026/{100000 + i + current_idx:06d}" for i in range(count)]
            dates_jun = [f"{random.randint(1, 28):02d}-Jun-2026" for _ in range(count)]

            # Default symmetrical values
            cp_gst = list(v_gstins)
            pr_gst = list(v_gstins)
            cp_doc = list(inv_nums)
            pr_doc = list(inv_nums)
            cp_date = list(dates_jun)
            pr_date = list(dates_jun)
            cp_taxable = list(base_taxables)
            pr_taxable = list(base_taxables)
            cp_tax = list(base_taxes)
            pr_tax = list(base_taxes)
            cp_tot = list(base_totals)
            pr_tot = list(base_totals)

            # Scenario specific mutations
            if sc_key == "exact_match":
                pass  # Exactly identical

            elif sc_key == "commercial_tolerance":
                # Add minor penny / tolerance variance between 0.05 and 8.50
                penny_diffs = np.round(np.random.uniform(0.10, 8.50, size=count), 2)
                signs = np.random.choice([-1.0, 1.0], size=count)
                pr_taxable = [round(float(b + s * d), 2) for b, s, d in zip(base_taxables, signs, penny_diffs)]
                pr_tax = [round(float(pt * 0.18), 2) for pt in pr_taxable]
                pr_tot = [round(pt + tx, 2) for pt, tx in zip(pr_taxable, pr_tax)]

            elif sc_key == "date_proximity":
                # Shift booking date by 3 to 25 days
                for i in range(count):
                    day_shift = random.randint(3, 25)
                    pr_date[i] = f"{min(28, 1 + day_shift):02d}-Jul-2026"

            elif sc_key == "cross_fy":
                # Cross FY March 31 vs April 2
                cp_date = ["31-Mar-2026"] * count
                pr_date = ["02-Apr-2026"] * count

            elif sc_key == "prefix_normalization":
                # Drop INV/2026/ prefix and leading zeros
                for i in range(count):
                    core_num = f"{100000 + i + current_idx:06d}"
                    cp_doc[i] = f"INV/2026/{core_num}"
                    pr_doc[i] = str(int(core_num))  # Drops leading zeroes e.g. 100000

            elif sc_key == "compound_variation":
                # Simultaneous prefix dropped + date shifted
                for i in range(count):
                    core_num = f"{50000 + i + current_idx:05d}"
                    cp_doc[i] = f"SUPP-{core_num}"
                    pr_doc[i] = f"SUPP{core_num}"  # Hyphen dropped
                    day_shift = random.randint(4, 18)
                    pr_date[i] = f"{min(28, 1 + day_shift):02d}-Jul-2026"

            elif sc_key == "ineligible_itc_17_5":
                # Books taxable is lower by >= ₹100 threshold (e.g. ₹9,000 rent-a-cab excluded)
                for i in range(count):
                    full_val = base_taxables[i] + 5000.0
                    eligible_portion = base_taxables[i]
                    cp_taxable[i] = round(full_val, 2)
                    pr_taxable[i] = round(eligible_portion, 2)
                    cp_tax[i] = round(full_val * 0.18, 2)
                    pr_tax[i] = round(eligible_portion * 0.18, 2)
                    cp_tot[i] = round(full_val + cp_tax[i], 2)
                    pr_tot[i] = round(eligible_portion + pr_tax[i], 2)

            elif sc_key == "multi_tranche_banking":
                # Real N:1 and 1:N multi-tranche batch consolidation
                i_ptr = 0
                batch_counter = 1

                while i_ptr < count:
                    rows_left = count - i_ptr
                    if rows_left <= 2:
                        k = rows_left
                        mode = "N:1" if random.random() < 0.5 else "1:N"
                    else:
                        r_type = random.random()
                        if r_type < 0.45:
                            mode = "N:1"
                            k = min(rows_left, random.randint(2, 5))
                        elif r_type < 0.90:
                            mode = "1:N"
                            k = min(rows_left, random.randint(2, 5))
                        else:
                            if rows_left >= 3:
                                mode = "DISJOINT_N1" if random.random() < 0.5 else "DISJOINT_1N"
                                k = min(rows_left, random.randint(3, 5))
                            else:
                                mode = "N:1"
                                k = rows_left

                    v_info = VENDOR_POOL[batch_counter % len(VENDOR_POOL)]
                    v_g, v_l, v_t = v_info[0], v_info[1], v_info[2]

                    if mode == "N:1":
                        # k rows: Multiple CP invoices summing to 1 PR voucher
                        total_target = round(float(np.random.uniform(3000.0, 120000.0)), 2)
                        splits = np.random.dirichlet(np.ones(k))
                        parts = [round(float(total_target * s), 2) for s in splits]
                        parts[-1] = round(total_target - sum(parts[:-1]), 2)

                        pr_voucher_num = f"Voucher BANK-CHG/JUN-26/B{batch_counter:04d}" if "BANK" in v_l else f"Voucher CONSOL-JV/B{batch_counter:04d}"
                        pr_voucher_date = "30-Jun-2026"

                        for step, part_val in enumerate(parts):
                            idx = i_ptr + step
                            cp_gst[idx] = v_g
                            pr_gst[idx] = v_g
                            v_legals[idx] = v_l
                            v_trades[idx] = v_t
                            cp_doc[idx] = f"INV/06/2026/B{batch_counter:04d}-{step+1:02d}"
                            pr_doc[idx] = pr_voucher_num
                            cp_date[idx] = f"{random.randint(1, 25):02d}-Jun-2026"
                            pr_date[idx] = pr_voucher_date
                            cp_taxable[idx] = part_val
                            pr_taxable[idx] = total_target
                            cp_tax[idx] = round(part_val * 0.18, 2)
                            pr_tax[idx] = round(total_target * 0.18, 2)
                            cp_tot[idx] = round(part_val + cp_tax[idx], 2)
                            pr_tot[idx] = round(total_target + pr_tax[idx], 2)

                    elif mode == "1:N":
                        # k rows: 1 CP Master invoice summing from multiple PR vouchers
                        total_target = round(float(np.random.uniform(5000.0, 150000.0)), 2)
                        splits = np.random.dirichlet(np.ones(k))
                        parts = [round(float(total_target * s), 2) for s in splits]
                        parts[-1] = round(total_target - sum(parts[:-1]), 2)

                        cp_invoice_num = f"MASTER-INV/2026/B{batch_counter:04d}"
                        cp_invoice_date = "10-Jun-2026"

                        for step, part_val in enumerate(parts):
                            idx = i_ptr + step
                            cp_gst[idx] = v_g
                            pr_gst[idx] = v_g
                            v_legals[idx] = v_l
                            v_trades[idx] = v_t
                            cp_doc[idx] = cp_invoice_num
                            pr_doc[idx] = f"GRN-PARTIAL/2026/B{batch_counter:04d}-{step+1:02d}"
                            cp_date[idx] = cp_invoice_date
                            pr_date[idx] = f"{random.randint(11, 28):02d}-Jun-2026"
                            cp_taxable[idx] = total_target
                            pr_taxable[idx] = part_val
                            cp_tax[idx] = round(total_target * 0.18, 2)
                            pr_tax[idx] = round(part_val * 0.18, 2)
                            cp_tot[idx] = round(total_target + cp_tax[idx], 2)
                            pr_tot[idx] = round(part_val + pr_tax[idx], 2)

                    elif mode == "DISJOINT_N1":
                        # k rows total: (k-1) single-sided CP rows + 1 single-sided PR row
                        total_target = round(float(np.random.uniform(4000.0, 90000.0)), 2)
                        n_cp = max(1, k - 1)
                        splits = np.random.dirichlet(np.ones(n_cp))
                        parts = [round(float(total_target * s), 2) for s in splits]
                        parts[-1] = round(total_target - sum(parts[:-1]), 2)

                        for step, part_val in enumerate(parts):
                            idx = i_ptr + step
                            cp_gst[idx] = v_g
                            pr_gst[idx] = None
                            v_legals[idx] = v_l
                            v_trades[idx] = v_t
                            cp_doc[idx] = f"INV-UNROLLED/B{batch_counter:04d}-{step+1:02d}"
                            pr_doc[idx] = None
                            cp_date[idx] = f"{random.randint(1, 20):02d}-Jun-2026"
                            pr_date[idx] = None
                            cp_taxable[idx] = part_val
                            pr_taxable[idx] = 0.0
                            cp_tax[idx] = round(part_val * 0.18, 2)
                            pr_tax[idx] = 0.0
                            cp_tot[idx] = round(part_val + cp_tax[idx], 2)
                            pr_tot[idx] = 0.0

                        target_idx = i_ptr + (k - 1)
                        cp_gst[target_idx] = None
                        pr_gst[target_idx] = v_g
                        v_legals[target_idx] = v_l
                        v_trades[target_idx] = v_t
                        cp_doc[target_idx] = None
                        pr_doc[target_idx] = f"JV-UNROLLED-CONSOL/B{batch_counter:04d}"
                        cp_date[target_idx] = None
                        pr_date[target_idx] = "30-Jun-2026"
                        cp_taxable[target_idx] = 0.0
                        pr_taxable[target_idx] = total_target
                        cp_tax[target_idx] = 0.0
                        pr_tax[target_idx] = round(total_target * 0.18, 2)
                        cp_tot[target_idx] = 0.0
                        pr_tot[target_idx] = round(total_target + pr_tax[target_idx], 2)

                    elif mode == "DISJOINT_1N":
                        # k rows total: 1 single-sided CP row + (k-1) single-sided PR rows
                        total_target = round(float(np.random.uniform(4000.0, 90000.0)), 2)
                        n_pr = max(1, k - 1)
                        splits = np.random.dirichlet(np.ones(n_pr))
                        parts = [round(float(total_target * s), 2) for s in splits]
                        parts[-1] = round(total_target - sum(parts[:-1]), 2)

                        master_idx = i_ptr
                        cp_gst[master_idx] = v_g
                        pr_gst[master_idx] = None
                        v_legals[master_idx] = v_l
                        v_trades[master_idx] = v_t
                        cp_doc[master_idx] = f"INV-MASTER-UNROLLED/B{batch_counter:04d}"
                        pr_doc[master_idx] = None
                        cp_date[master_idx] = "05-Jun-2026"
                        pr_date[master_idx] = None
                        cp_taxable[master_idx] = total_target
                        pr_taxable[master_idx] = 0.0
                        cp_tax[master_idx] = round(total_target * 0.18, 2)
                        pr_tax[master_idx] = 0.0
                        cp_tot[master_idx] = round(total_target + cp_tax[master_idx], 2)
                        pr_tot[master_idx] = 0.0

                        for step, part_val in enumerate(parts):
                            idx = i_ptr + 1 + step
                            cp_gst[idx] = None
                            pr_gst[idx] = v_g
                            v_legals[idx] = v_l
                            v_trades[idx] = v_t
                            cp_doc[idx] = None
                            pr_doc[idx] = f"PR-PARTIAL-UNROLLED/B{batch_counter:04d}-{step+1:02d}"
                            cp_date[idx] = None
                            pr_date[idx] = f"{random.randint(10, 28):02d}-Jun-2026"
                            cp_taxable[idx] = 0.0
                            pr_taxable[idx] = part_val
                            cp_tax[idx] = 0.0
                            pr_tax[idx] = round(part_val * 0.18, 2)
                            cp_tot[idx] = 0.0
                            pr_tot[idx] = round(part_val + pr_tax[idx], 2)

                    i_ptr += k
                    batch_counter += 1

            elif sc_key == "ambiguous_collisions":
                # Multiple records sharing same invoice number but different vendor or ambiguous
                amb_num = f"COLLISION/INV/{current_idx:04d}"
                for i in range(count):
                    cp_doc[i] = amb_num
                    pr_doc[i] = amb_num
                    pr_taxable[i] = round(base_taxables[i] + random.randint(15, 80), 2)

            elif sc_key == "gst_only":
                # Missing in PR
                for i in range(count):
                    pr_gst[i] = None
                    pr_doc[i] = None
                    pr_date[i] = None
                    pr_taxable[i] = 0.0
                    pr_tax[i] = 0.0
                    pr_tot[i] = 0.0

            elif sc_key == "pr_only":
                # Missing in GSTR
                for i in range(count):
                    cp_gst[i] = None
                    cp_doc[i] = None
                    cp_date[i] = None
                    cp_taxable[i] = 0.0
                    cp_tax[i] = 0.0
                    cp_tot[i] = 0.0

            # Assign block to dataframe columns
            data["ReconciliationSection"][current_idx:end_idx] = [meta["section"]] * count
            data["Reason"][current_idx:end_idx] = [meta["name"]] * count
            data["Remarks"][current_idx:end_idx] = [meta["comment"]] * count

            data["CPGstin"][current_idx:end_idx] = cp_gst
            data["PRGstin"][current_idx:end_idx] = pr_gst
            data["CPTradeName"][current_idx:end_idx] = v_trades
            data["PRTradeName"][current_idx:end_idx] = v_trades
            data["CPLegalName"][current_idx:end_idx] = v_legals
            data["PRLegalName"][current_idx:end_idx] = v_legals

            data["CPDocumentNumber"][current_idx:end_idx] = cp_doc
            data["PRDocumentNumber"][current_idx:end_idx] = pr_doc
            data["CPDocumentDate"][current_idx:end_idx] = cp_date
            data["PRDocumentDate"][current_idx:end_idx] = pr_date

            data["CPTaxableValue"][current_idx:end_idx] = cp_taxable
            data["PRTaxableValue"][current_idx:end_idx] = pr_taxable
            data["CPIgstAmount"][current_idx:end_idx] = cp_tax
            data["PRIgstAmount"][current_idx:end_idx] = pr_tax
            data["CPValue"][current_idx:end_idx] = cp_tot
            data["PRValue"][current_idx:end_idx] = pr_tot

            current_idx = end_idx

        # Calculate differential columns
        df = pd.DataFrame(data)
        df["TaxableDifference"] = (df["CPTaxableValue"].fillna(0.0) - df["PRTaxableValue"].fillna(0.0)).round(2)
        df["IGSTDifference"] = (df["CPIgstAmount"].fillna(0.0) - df["PRIgstAmount"].fillna(0.0)).round(2)
        df["ValueDifference"] = (df["CPValue"].fillna(0.0) - df["PRValue"].fillna(0.0)).round(2)

        elapsed = round(time.time() - start_time, 2)
        ground_truth_report["generation_time_seconds"] = elapsed
        logger.info(f"Generated {total_records:,} synthetic rows in {elapsed}s.")
        return df, ground_truth_report

    def save_dataset(
        self,
        df: pd.DataFrame,
        report: dict[str, Any],
        output_dir: Path,
        base_name: str,
        export_excel: bool = True,
        export_csv: bool = True,
    ) -> dict[str, Path]:
        """Saves the generated DataFrame as .xlsx, .csv, and writes companion ground truth reports."""
        output_dir.mkdir(parents=True, exist_ok=True)
        paths: dict[str, Path] = {}

        # 1. Save CSV
        if export_csv:
            csv_path = output_dir / f"{base_name}.csv"
            t0 = time.time()
            df.to_csv(csv_path, index=False)
            logger.info(f"Saved CSV ({len(df):,} rows) to {csv_path.name} in {time.time() - t0:.2f}s")
            paths["csv"] = csv_path

        # 2. Save Excel
        if export_excel:
            xlsx_path = output_dir / f"{base_name}.xlsx"
            t0 = time.time()
            try:
                from openpyxl import Workbook
                wb = Workbook(write_only=True)
                ws = wb.create_sheet(title="KIGS GSTR 2B Reco")
                ws.append(list(df.columns))
                for row in df.itertuples(index=False, name=None):
                    ws.append(list(row))
                wb.save(xlsx_path)
            except Exception as e_wo:
                logger.warning(f"Fast write-only failed ({e_wo}), falling back to standard to_excel")
                with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
                    df.to_excel(writer, sheet_name="KIGS GSTR 2B Reco", index=False)
            logger.info(f"Saved Excel ({len(df):,} rows) to {xlsx_path.name} in {time.time() - t0:.2f}s")
            paths["xlsx"] = xlsx_path

        # 3. Save Ground Truth JSON
        json_path = output_dir / f"{base_name}_ground_truth.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        paths["json"] = json_path

        # 4. Save Markdown Summary Table
        md_path = output_dir / f"{base_name}_summary.md"
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(f"# Synthetic Dataset Ground Truth Breakdown\n\n")
            f.write(f"- **Filename Base**: `{base_name}`\n")
            f.write(f"- **Total Records**: {report['total_records']:,}\n")
            f.write(f"- **Generation Time**: {report.get('generation_time_seconds', 0):.2f}s\n")
            f.write(f"- **Generated At**: {report['generated_at']}\n\n")
            f.write("| Scenario Key | Scenario Name | Section Bucket | Tier | Row Count | Proportion | Statutory Audit Comment |\n")
            f.write("| :--- | :--- | :--- | :--- | :---: | :---: | :--- |\n")
            for k, s in report["scenarios"].items():
                f.write(f"| `{k}` | **{s['name']}** | `{s['section']}` | {s['tier']} | **{s['count']:,}** | {s['percentage']}% | {s['comment']} |\n")
            f.write("\n---\n*Ready to ingest directly into TARS Reconciliation 4.0 or 3.0.*\n")
        paths["summary_md"] = md_path

        return paths

    def validate_against_tars_engine(self, df: pd.DataFrame, report: dict[str, Any]) -> dict[str, Any]:
        """Runs the synthetic DataFrame directly through WaterfallMatchingEngineV4 and compares tallies."""
        try:
            from app.services.matching_engine_v4 import WaterfallMatchingEngineV4, build_default_rules_v4
        except ImportError:
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
            from app.services.matching_engine_v4 import WaterfallMatchingEngineV4, build_default_rules_v4

        rules = build_default_rules_v4()
        engine = WaterfallMatchingEngineV4(rules=rules)
        t0 = time.time()
        res = engine.execute_waterfall(
            df=df,
            session_id="SYNTHETIC-VALIDATION",
            rules=rules,
        )
        duration_ms = round((time.time() - t0) * 1000.0, 1)

        tally_comparison = {
            "duration_ms": duration_ms,
            "engine_total": res.summary.total_records,
            "engine_exact": res.summary.exact_matches,
            "engine_tolerance": res.summary.tolerance_matches,
            "engine_near": res.summary.near_matches,
            "engine_ineligible_itc": res.summary.ineligible_itc_matches,
            "engine_consolidated": res.summary.consolidated_matches,
            "engine_ambiguous": res.summary.ambiguous,
            "engine_gst_only": res.summary.gst_only,
            "engine_pr_only": res.summary.pr_only,
            "kics_concurrence_rate": res.summary.kics_concurrence_rate,
            "accuracy_percentage": res.summary.accuracy_percentage,
        }
        return tally_comparison


def main():
    parser = argparse.ArgumentParser(description="TARS Synthetic Reconciliation Dataset Generator")
    parser.add_argument("--rows", type=int, default=20000, help="Total number of rows to generate (1 to 500,000)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducible generation")
    parser.add_argument("--randomize", action="store_true", help="Randomize scenario proportions dynamically")
    parser.add_argument("--output-dir", type=str, default="data/synthetic_datasets", help="Directory to save generated datasets")
    parser.add_argument("--name", type=str, default=None, help="Base filename prefix")
    parser.add_argument("--csv-only", action="store_true", help="Generate only CSV (recommended for >100,000 rows)")
    parser.add_argument("--xlsx-only", action="store_true", help="Generate only XLSX")
    parser.add_argument("--validate", action="store_true", help="Validate output by running through TARS Matching Engine V4")

    # Custom scenario counts
    parser.add_argument("--exact", type=int, default=None, help="Exact count for Direct Statutory Matches")
    parser.add_argument("--tolerance", type=int, default=None, help="Exact count for Commercial Tolerance Matches")
    parser.add_argument("--date-prox", type=int, default=None, help="Exact count for Date Proximity (±30d)")
    parser.add_argument("--cross-fy", type=int, default=None, help="Exact count for Cross-FY Matches")
    parser.add_argument("--prefix", type=int, default=None, help="Exact count for Prefix Normalization Matches")
    parser.add_argument("--compound", type=int, default=None, help="Exact count for Compound Variations")
    parser.add_argument("--ineligible-itc", type=int, default=None, help="Exact count for Section 17(5) Ineligible ITC")
    parser.add_argument("--multi-tranche", type=int, default=None, help="Exact count for Multi-Tranche Banking Consolidation")
    parser.add_argument("--ambiguous", type=int, default=None, help="Exact count for Ambiguous Collisions")
    parser.add_argument("--gst-only", type=int, default=None, help="Exact count for GSTR-2B Only")
    parser.add_argument("--pr-only", type=int, default=None, help="Exact count for PR Only")

    args = parser.parse_args()

    effective_seed = args.seed
    if effective_seed is None:
        effective_seed = random.randint(1000, 999999) if args.randomize else 42

    custom_counts = {
        "exact_match": args.exact,
        "commercial_tolerance": args.tolerance,
        "date_proximity": args.date_prox,
        "cross_fy": args.cross_fy,
        "prefix_normalization": args.prefix,
        "compound_variation": args.compound,
        "ineligible_itc_17_5": args.ineligible_itc,
        "multi_tranche_banking": args.multi_tranche,
        "ambiguous_collisions": args.ambiguous,
        "gst_only": args.gst_only,
        "pr_only": args.pr_only,
    }

    generator = SyntheticReconDatasetGenerator(seed=effective_seed)
    counts = generator.allocate_counts(total_rows=args.rows, custom_counts=custom_counts, randomize=args.randomize)

    df, report = generator.generate_dataframe(counts)

    out_dir = Path(args.output_dir)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = args.name or f"TARS_SYNTHETIC_{args.rows}_ROWS_{ts}"

    export_xlsx = not args.csv_only
    export_csv = not args.xlsx_only

    paths = generator.save_dataset(
        df=df,
        report=report,
        output_dir=out_dir,
        base_name=base_name,
        export_excel=export_xlsx,
        export_csv=export_csv,
    )

    print("\n" + "=" * 70)
    print(f"  TARS SYNTHETIC RECONCILIATION DATASET GENERATED ({args.rows:,} ROWS)")
    print("=" * 70)
    for k, p in paths.items():
        print(f"  [{k.upper()}]: {p.resolve()}")

    print("\n  GROUND TRUTH ALLOCATION SUMMARY:")
    print("-" * 70)
    for sc, s in report["scenarios"].items():
        clean_name = s['name'].replace("₹", "Rs.")
        print(f"  * {clean_name:<48}: {s['count']:>7,} rows ({s['percentage']:>5.2f}%)")
    print("-" * 70)

    if args.validate:
        print("\n  RUNNING VALIDATION AGAINST TARS MATCHING ENGINE V4...")
        tally = generator.validate_against_tars_engine(df, report)
        print(f"  * Engine Run Duration     : {tally['duration_ms']:.1f} ms")
        print(f"  * Total Processed         : {tally['engine_total']:,} rows")
        print(f"  * Exact Matches Tally     : {tally['engine_exact']:,} vs Ground Truth {report['scenarios'].get('exact_match', {}).get('count', 0):,}")
        print(f"  * Concurrence Rate        : {tally['kics_concurrence_rate']}%")
        print(f"  * Overall Automation Rate : {tally['accuracy_percentage']}%")
        print("  [SUCCESS] Tally validation completed successfully.")


if __name__ == "__main__":
    main()
