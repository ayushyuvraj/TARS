import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  apiV2,
  DirectColumnCorrelation,
  Rule2Item,
  SimulationResultV2,
  DateToleranceUnit,
  NumericToleranceMode,
  NormalizationType,
  MatchStrategy,
} from "./api_v2";
import {
  Sparkles,
  Play,
  ArrowRight,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Info,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ShieldCheck,
  X,
  Sliders,
  Check,
  GripVertical,
  StopCircle,
  Activity,
} from "lucide-react";
import { ReconciliationV2ActionBar } from "./ReconciliationV2ActionBar";
import { copilotV2Bridge } from "./copilot_v2_bridge";
import "./rules_v2.css";

interface Props {
  sessionId: string;
  correlations: DirectColumnCorrelation[];
  prColumns: string[];
  onBackToMapping: () => void;
  onProceedToResults: (selectedRuleIds: string[], executionOrder: string[]) => void;
}

const ALL_NORMALIZERS: { type: NormalizationType; label: string; description?: string }[] = [
  { type: "TRIM_WHITESPACE", label: "Clean Spaces", description: "Trim leading and trailing whitespace" },
  { type: "STRIP_SPECIAL_CHARS", label: "Strip Symbols (+, -, /, _)", description: "Strip punctuation and delimiter symbols" },
  { type: "REMOVE_PREFIXES", label: "Strip Prefixes (INV, BILL)", description: "Strip standard document prefixes like INV or BILL" },
  { type: "TRIM_LEADING_ZEROS", label: "Trim Leading Zeros (0042 → 42)", description: "Remove leading zeroes from numeric identifiers" },
  { type: "UPPERCASE", label: "Case Fold (A-Z)", description: "Normalize letters to uppercase" },
];

const DEFAULT_RULES_CATALOG: Rule2Item[] = [
  {
    id: "RW2-001",
    name: "Supplier GSTIN Identity Match",
    description: "Matches vendor GST identification numbers between Government portal and Client Purchase Register.",
    category: "CORE_IDENTITY",
    rule_tier: "CORE_STATUTORY",
    statutory_reference: "CGST Act Sec 16(2)(a) • Rule 46(a)",
    advisory_caution: "Word of Caution: Primary statutory anchor. Disabling this allows cross-vendor matches and invalidates ITC claims under Section 16(2)(aa).",
    gstr_column: "BillFromGstin",
    pr_column: "BillFromGstin",
    canonical_concept: "gstin",
    strategy: "NORMALIZED_TEXT",
    normalizers: ["TRIM_WHITESPACE", "STRIP_SPECIAL_CHARS", "UPPERCASE"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 1,
    plain_english_explanation: "Verifies that the Supplier GSTIN reported in Government GSTR-2B exactly matches the Supplier GSTIN in your ERP ledger, after stripping spaces and punctuation.",
    why_it_matters: "Under Section 16(2)(aa) of the CGST Act, Input Tax Credit (ITC) can only be claimed if the supplier has filed their tax return under their exact registered GSTIN.",
    column_status: "AVAILABLE",
  },
  {
    id: "RW2-002",
    name: "Invoice / Document Number Canonical Match",
    description: "Matches invoice, debit note, and credit note numbers across ledgers with smart prefix stripping.",
    category: "DOCUMENT_REFERENCE",
    rule_tier: "CORE_STATUTORY",
    statutory_reference: "CGST Act Sec 16(2)(a) • Rule 46(b)",
    advisory_caution: "Word of Caution: Primary document identifier. Disabling this will cause arbitrary matching across different transactions from the same supplier.",
    gstr_column: "DocumentNumber",
    pr_column: "DocumentNumber",
    canonical_concept: "document_number",
    strategy: "NORMALIZED_TEXT",
    normalizers: ["TRIM_WHITESPACE", "STRIP_SPECIAL_CHARS", "REMOVE_PREFIXES", "TRIM_LEADING_ZEROS", "UPPERCASE"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 2,
    plain_english_explanation: "Matches invoice numbers even when ERP stores '00042' or 'INV/2026/42' while Government portal shows '42' by stripping standard prefixes and leading zeroes.",
    why_it_matters: "Vendors and ERP systems format document numbers differently. Stripping standard prefixes unlocks up to 35% of otherwise unmatched invoices without audit risk.",
    column_status: "AVAILABLE",
  },
  {
    id: "RW2-003",
    name: "Invoice Date Proximity Window",
    description: "Allows a flexible calendar window between the invoice issue date and accounting booking date.",
    category: "TEMPORAL_WINDOW",
    rule_tier: "COMMERCIAL_POLICY",
    statutory_reference: "CGST Act Sec 16(2)(aa) • Rule 46(c)",
    advisory_caution: "Advisory: Accommodates transit and monthly accounting delays. Expanding beyond 60 days increases risk of claiming credit outside the statutory fiscal year window.",
    gstr_column: "DocumentDate",
    pr_column: "DocumentDate",
    canonical_concept: "document_date",
    strategy: "DATE_PROXIMITY",
    normalizers: ["TRIM_WHITESPACE"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 30,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 3,
    plain_english_explanation: "Allows the document date between Government GSTR-2B and Purchase Register to vary by up to 30 days (or 1 month).",
    why_it_matters: "Suppliers frequently issue bills at month-end while corporate accounts payable teams record them in the subsequent month after physical goods receipt.",
    column_status: "AVAILABLE",
  },
  {
    id: "RW2-004",
    name: "Taxable Value Commercial Tolerance",
    description: "Absorbs rounding fractions and commercial differences in base taxable supply amounts.",
    category: "FINANCIAL_VALUE",
    rule_tier: "CORE_STATUTORY",
    statutory_reference: "CGST Act Sec 16(2)(aa) • Rule 46(i)",
    advisory_caution: "Word of Caution: Primary financial quantum. Disabling this defaults to strict ₹0.00 exact equality. Ensure commercial rounding differences are absorbed.",
    gstr_column: "TaxableValue",
    pr_column: "TaxableValue",
    canonical_concept: "taxable_value",
    strategy: "NUMERIC_TOLERANCE",
    normalizers: ["TRIM_WHITESPACE"],
    tolerance_value: 10,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 4,
    plain_english_explanation: "Considers taxable amounts matching if the variance between Government and Purchase Register is within ± ₹10.00.",
    why_it_matters: "Small discrepancies typically arise from item-level vs header-level rounding algorithms and fractional packaging charges.",
    column_status: "AVAILABLE",
  },
  {
    id: "RW2-005",
    name: "Total Invoice Value (Gross Amount) Match",
    description: "Verifies the grand total invoice value inclusive of all taxes and cess charges.",
    category: "FINANCIAL_VALUE",
    rule_tier: "COMMERCIAL_POLICY",
    statutory_reference: "CGST Rules Rule 46(h)",
    advisory_caution: "Advisory: Verifies invoice grand total including all taxes. Protects against under-claiming or over-claiming gross purchase register balances.",
    gstr_column: "DocumentValue",
    pr_column: "DocumentValue",
    canonical_concept: "total_value",
    strategy: "NUMERIC_TOLERANCE",
    normalizers: ["TRIM_WHITESPACE"],
    tolerance_value: 10,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 5,
    plain_english_explanation: "Ensures the total invoice value (taxable + GST + cess) matches within ± ₹10.00.",
    why_it_matters: "Protects against under-claiming or over-claiming gross purchase register balances submitted for financial audit sign-off.",
    column_status: "AVAILABLE",
  },
  {
    id: "RW2-006",
    name: "Payment Date Compliance (180-Day Rule)",
    description: "Evaluates payment date lag against statutory 180-day ITC reversal mandate.",
    category: "TEMPORAL_WINDOW",
    rule_tier: "COMMERCIAL_POLICY",
    statutory_reference: "Second Proviso to CGST Sec 16(2)",
    advisory_caution: "Advisory: Statutory mandate requires ITC reversal with 18% interest under Section 50 if payment is not made to supplier within 180 days.",
    gstr_column: "PaymentDate",
    pr_column: "PaymentDate",
    canonical_concept: "payment_date",
    strategy: "DATE_PROXIMITY",
    normalizers: ["TRIM_WHITESPACE"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 180,
    date_tolerance_unit: "DAYS",
    is_enabled: false,
    execution_order: 6,
    plain_english_explanation: "Checks that the payment date is within 180 days of the invoice date.",
    why_it_matters: "Second proviso to Section 16(2) requires recipient taxpayers to reverse ITC if payment is not made to the supplier within 180 days from invoice issue.",
    column_status: "MISSING",
    missing_reason: "Column 'PaymentDate' not found or unmapped in Client Purchase Register.",
  },
  {
    id: "RW2-007",
    name: "Reverse Charge Mechanism (RCM) Alignment",
    description: "Ensures both workbooks agree on whether tax is payable under forward charge or reverse charge.",
    category: "COMPLIANCE_GUARD",
    rule_tier: "CORE_STATUTORY",
    statutory_reference: "CGST Rules Rule 46(p) • Sec 9(3)/9(4)",
    advisory_caution: "Word of Caution: Mismatched RCM flags lead to erroneous cash tax liability payments under GSTR-3B Table 3.1(d).",
    gstr_column: "ReverseCharge",
    pr_column: "ReverseCharge",
    canonical_concept: "reverse_charge",
    strategy: "VALUE_GUARD",
    normalizers: ["TRIM_WHITESPACE", "UPPERCASE"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 7,
    plain_english_explanation: "Verifies that if an invoice is marked as Reverse Charge ('Y') in Government GSTR-2B, it is also flagged as Reverse Charge in your ERP.",
    why_it_matters: "Mismatched RCM flags lead to erroneous cash tax liability payments under GSTR-3B Table 3.1(d).",
    column_status: "AVAILABLE",
  },
  {
    id: "RW2-008",
    name: "Document Type Classification Alignment",
    description: "Strictly ensures Invoices, Credit Notes, and Debit Notes are not crossed during reconciliation.",
    category: "COMPLIANCE_GUARD",
    rule_tier: "CORE_STATUTORY",
    statutory_reference: "CGST Act Sec 34 • Rule 46",
    advisory_caution: "Word of Caution: Invoices and Credit Notes have opposite financial signs. Disabling this rule risks netting errors and inverted ITC claims.",
    gstr_column: "DocumentType",
    pr_column: "DocumentType",
    canonical_concept: "document_type",
    strategy: "VALUE_GUARD",
    normalizers: ["TRIM_WHITESPACE", "UPPERCASE"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 8,
    plain_english_explanation: "Verifies that document classifications (Invoice vs Credit Note vs Debit Note) agree strictly across ledgers.",
    why_it_matters: "Matching a Credit Note against an Invoice reverses the sign of tax amounts and distorts net eligible input tax credit.",
    column_status: "AVAILABLE",
  },
  {
    id: "RW2-009",
    name: "Place of Supply (POS) State Code Alignment",
    description: "Validates recipient state code between GSTR-2B and ERP to prevent inter-state vs intra-state mismatch.",
    category: "COMPLIANCE_GUARD",
    rule_tier: "COMMERCIAL_POLICY",
    statutory_reference: "CGST Rules Rule 46(e)/(m) • IGST Sec 12",
    advisory_caution: "Advisory: Validates supply jurisdiction. Discrepancies between IGST and CGST/SGST trigger credit disallowance.",
    gstr_column: "PlaceOfSupply",
    pr_column: "PlaceOfSupply",
    canonical_concept: "place_of_supply",
    strategy: "NORMALIZED_TEXT",
    normalizers: ["TRIM_WHITESPACE", "STRIP_SPECIAL_CHARS", "UPPERCASE"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 9,
    plain_english_explanation: "Verifies that Place of Supply state codes agree between Government portal and Purchase Register after normalising punctuation.",
    why_it_matters: "Input tax credit eligibility depends on correct supply classification (IGST vs CGST/SGST) under Section 12 of IGST Act.",
    column_status: "AVAILABLE",
  },
  {
    id: "RW2-010",
    name: "Total Tax Amount (IGST / CGST / SGST) Tolerance",
    description: "Absorbs small penny rounding fractions and item-level vs header-level tax differences.",
    category: "FINANCIAL_VALUE",
    rule_tier: "COMMERCIAL_POLICY",
    statutory_reference: "CGST Rules Rule 46(k)",
    advisory_caution: "Advisory: Absorbs item-level tax rounding differences (e.g. ± ₹5.00) between ERP tax engines and GST portal rounding rules.",
    gstr_column: "TotalTaxAmount",
    pr_column: "TotalTaxAmount",
    canonical_concept: "tax_amount",
    strategy: "NUMERIC_TOLERANCE",
    normalizers: ["TRIM_WHITESPACE"],
    tolerance_value: 5,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: true,
    execution_order: 10,
    plain_english_explanation: "Ensures the cumulative tax amount (IGST + CGST + SGST) matches within ± ₹5.00 to account for rounding.",
    why_it_matters: "Protects against under-claiming or over-claiming specific tax heads while preventing false rejections from ₹1–₹2 fraction rounding.",
    column_status: "AVAILABLE",
  },
];

const DEFAULT_AI_SUGGESTED_RULES: Rule2Item[] = [
  {
    id: "AI-SUGG-HSN",
    name: "HSN / SAC Code Canonical Classification Match",
    description: "Matches goods and services tariff classification codes between Government portal and Purchase Register.",
    category: "AI_SUGGESTED",
    rule_tier: "AUXILIARY_METADATA",
    statutory_reference: "CGST Rules Rule 46(f)",
    advisory_caution: "Match Impact Notice: Auxiliary ERP metadata. HSN codes often have 4-digit vs 6-digit or 8-digit granularity. Enabling as a strict rule may reduce match rate by 15–25%.",
    gstr_column: "HsnSac",
    pr_column: "HsnSac",
    canonical_concept: "hsn",
    strategy: "NORMALIZED_TEXT",
    normalizers: ["TRIM_WHITESPACE", "STRIP_SPECIAL_CHARS", "TRIM_LEADING_ZEROS"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: false,
    execution_order: 21,
    plain_english_explanation: "Validates HSN/SAC tariff classification across records after stripping leading zeroes and punctuation.",
    why_it_matters: "Mandatory HSN reporting under Rule 46(f) requires correct 4, 6, or 8 digit classification depending on aggregate turnover.",
    column_status: "AVAILABLE",
    ai_rationale: "AI Data Study: Both workbooks contain HSN/SAC tariff fields. Canonical trimming prevents 6-digit vs 8-digit classification mismatches.",
    is_ai_suggested: true,
  },
  {
    id: "AI-SUGG-VNDR",
    name: "Supplier Legal / Trade Name Secondary Verification",
    description: "Secondary identity verification validating vendor trading names after stripping punctuation and entity abbreviations.",
    category: "AI_SUGGESTED",
    rule_tier: "AUXILIARY_METADATA",
    advisory_caution: "Match Impact Notice: Auxiliary ERP metadata. Vendor trading names frequently differ between ERP and portal (e.g. 'Pvt Ltd' vs 'Private Limited'). Recommended for near-match scoring only.",
    gstr_column: "TradeName",
    pr_column: "VendorName",
    canonical_concept: "vendor_name",
    strategy: "NORMALIZED_TEXT",
    normalizers: ["TRIM_WHITESPACE", "STRIP_SPECIAL_CHARS", "UPPERCASE"],
    tolerance_value: 0,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: false,
    execution_order: 22,
    plain_english_explanation: "Verifies supplier entity name across books with case folding and punctuation stripping.",
    why_it_matters: "Helps detect circular invoicing and misallocated vendor ledger entries where GSTIN was keyed with typographical errors.",
    column_status: "AVAILABLE",
    ai_rationale: "AI Data Study: Detected supplier trade/legal name columns. Normalization strips entity suffixes like 'PVT LTD' vs 'PRIVATE LIMITED'.",
    is_ai_suggested: true,
  },
  {
    id: "AI-SUGG-CESS",
    name: "Compensation Cess Commercial Tolerance",
    description: "Verifies GST compensation cess amounts with commercial fractional rounding tolerance.",
    category: "AI_SUGGESTED",
    rule_tier: "COMMERCIAL_POLICY",
    statutory_reference: "GST (Compensation to States) Act Sec 11",
    advisory_caution: "Advisory: Absorbs minor rounding fractions in Compensation Cess liabilities.",
    gstr_column: "CessAmount",
    pr_column: "CessAmount",
    canonical_concept: "cess",
    strategy: "NUMERIC_TOLERANCE",
    normalizers: ["TRIM_WHITESPACE"],
    tolerance_value: 5,
    tolerance_mode: "ABSOLUTE_INR",
    date_tolerance_value: 0,
    date_tolerance_unit: "DAYS",
    is_enabled: false,
    execution_order: 23,
    plain_english_explanation: "Verifies compensation cess matches within ± ₹5.00 commercial rounding variance.",
    why_it_matters: "Cess credit can only be offset against output Cess liability under Section 11 of GST (Compensation to States) Act.",
    column_status: "AVAILABLE",
    ai_rationale: "AI Data Study: Identified Compensation Cess tax columns in both datasets. Suggests ₹5 commercial variance guard to absorb rounding fractions.",
    is_ai_suggested: true,
  },
];

const getInitialRules = (corrs: DirectColumnCorrelation[] = []): Rule2Item[] => {
  const corrGstrSet = new Set(corrs.map((c) => (c.gstr_column || "").trim().toLowerCase()));
  const corrPrSet = new Set(corrs.map((c) => (c.selected_pr_column || "").trim().toLowerCase()));

  return DEFAULT_RULES_CATALOG.map((rule) => {
    // Only Payment Date (RW2-006) requires a special payment column check
    if (rule.id === "RW2-006") {
      const hasPaymentDate =
        corrGstrSet.has("paymentdate") ||
        corrPrSet.has("paymentdate") ||
        corrGstrSet.has("payment_date") ||
        corrPrSet.has("payment_date");
      return {
        ...rule,
        is_enabled: hasPaymentDate,
        column_status: hasPaymentDate ? "AVAILABLE" : "MISSING",
        missing_reason: hasPaymentDate ? null : "Column 'PaymentDate' not found or unmapped in Client Purchase Register.",
      };
    }
    // All other core rules: GSTIN, Doc No, Doc Date, Taxable Value, Total Amount, RCM are ENABLED by default
    return {
      ...rule,
      is_enabled: true,
      column_status: "AVAILABLE",
      missing_reason: null,
    };
  });
};

export const ReconciliationV2RulesStage: React.FC<Props> = ({
  sessionId,
  correlations,
  prColumns,
  onBackToMapping,
  onProceedToResults,
}) => {
  const [rules, setRules] = useState<Rule2Item[]>(() => {
    try {
      const saved = localStorage.getItem(`tars_v2_rules_${sessionId || "active"}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
    return getInitialRules(correlations);
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResultV2 | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [simulationAborted, setSimulationAborted] = useState<boolean>(false);

  // Dedicated AI Suggestions State - Filter out any rule already in initial pipeline
  const [aiSuggestedRules, setAiSuggestedRules] = useState<Rule2Item[]>(() => {
    let initialPipeline = getInitialRules(correlations);
    try {
      const saved = localStorage.getItem(`tars_v2_rules_${sessionId || "active"}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          initialPipeline = parsed;
        }
      }
    } catch {}
    return DEFAULT_AI_SUGGESTED_RULES.filter(
      (s) =>
        !initialPipeline.some(
          (r) =>
            r.id === s.id ||
            (s.canonical_concept && r.canonical_concept === s.canonical_concept) ||
            (r.gstr_column && s.gstr_column && r.gstr_column.toLowerCase() === s.gstr_column.toLowerCase())
        )
    );
  });
  const [isAiSuggesting, setIsAiSuggesting] = useState<boolean>(false);

  // Sync rules summary with Copilot Bridge
  useEffect(() => {
    copilotV2Bridge.setContext({
      rulesSummary: rules.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: Boolean(r.is_enabled),
      })),
      selectedRuleIds: rules.filter((r) => r.is_enabled).map((r) => r.id),
    });
  }, [rules]);

  // Handle Copilot actions: ADD_RULE and TOGGLE_RULE
  useEffect(() => {
    const unregAdd = copilotV2Bridge.registerActionHandler("ADD_RULE", (payload) => {
      if (payload.rule) {
        const newRule = { ...payload.rule, is_enabled: true };
        setRules((curr) => [...curr, newRule]);
      }
    });

    const unregToggle = copilotV2Bridge.registerActionHandler("TOGGLE_RULE", (payload) => {
      if (payload.rule_target) {
        const target = String(payload.rule_target).toLowerCase().trim();
        setRules((curr) =>
          curr.map((r) => {
            const rId = (r.id || "").toLowerCase();
            const rName = (r.name || "").toLowerCase();
            if (rId === target || rName.includes(target) || target.includes(rId)) {
              return { ...r, is_enabled: Boolean(payload.is_active) };
            }
            return r;
          })
        );
      }
    });

    return () => {
      unregAdd();
      unregToggle();
    };
  }, []);

  // Modal states
  const [explainingRule, setExplainingRule] = useState<Rule2Item | null>(null);
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [aiPrompt, setAiPrompt] = useState<string>("");
  const [isAiCompiling, setIsAiCompiling] = useState<boolean>(false);
  const [compiledPreview, setCompiledPreview] = useState<Rule2Item | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Drag and Drop state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Expanded Rule details state
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(new Set());

  const toggleRuleExpand = (ruleId: string) => {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  // Agentic Simulation HUD telemetry state
  const [simStep, setSimStep] = useState<number>(1);
  const [simElapsedMs, setSimElapsedMs] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isExplicitAbortRef = useRef<boolean>(false);

  // Load session rules (evaluated for column availability & AI suggestions)
  useEffect(() => {
    let isMounted = true;

    const loadRules = async () => {
      if (!sessionId) return;
      try {
        const data = await apiV2.getSessionRules(sessionId);
        if (isMounted) {
          if (data.pipeline_rules && data.pipeline_rules.length > 0) {
            // Read local storage to preserve any user-accepted AI rules
            let localCustomRules: Rule2Item[] = [];
            try {
              const saved = localStorage.getItem(`tars_v2_rules_${sessionId || "active"}`);
              if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                  localCustomRules = parsed.filter((r) => r.is_ai_suggested || r.id.startsWith("AI-"));
                }
              }
            } catch {}

            // Normalize rules
            const normalizedRules = data.pipeline_rules.map((r) => {
              if (r.id !== "RW2-006") {
                return {
                  ...r,
                  is_enabled: r.is_enabled !== undefined ? r.is_enabled : true,
                  column_status: "AVAILABLE" as const,
                  missing_reason: null,
                };
              }
              return r;
            });

            // Merge localCustomRules that aren't yet in normalizedRules
            const mergedRules = [...normalizedRules];
            for (const lcr of localCustomRules) {
              if (!mergedRules.some((mr) => mr.id === lcr.id || (lcr.canonical_concept && mr.canonical_concept === lcr.canonical_concept))) {
                mergedRules.push(lcr);
              }
            }

            setRules(mergedRules);
            try {
              localStorage.setItem(`tars_v2_rules_${sessionId || "active"}`, JSON.stringify(mergedRules));
            } catch {}

            // Filter suggestions against merged rules so already-accepted rules are never shown
            if (data.ai_suggested_rules) {
              const filtered = data.ai_suggested_rules.filter(
                (s) =>
                  !mergedRules.some(
                    (r) =>
                      r.id === s.id ||
                      (s.canonical_concept && r.canonical_concept === s.canonical_concept) ||
                      (r.gstr_column && s.gstr_column && r.gstr_column.toLowerCase() === s.gstr_column.toLowerCase())
                  )
              );
              setAiSuggestedRules(filtered);
            }
          }
        }
      } catch (err) {
        console.warn("Could not fetch session rules from API, keeping default catalog with local gating:", err);
      }
    };

    loadRules();

    return () => {
      isMounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [sessionId]);

  // Continuously persist active rules state so custom & accepted AI rules survive reloads
  useEffect(() => {
    if (rules.length > 0) {
      try {
        localStorage.setItem(`tars_v2_rules_${sessionId || "active"}`, JSON.stringify(rules));
      } catch {}
    }
  }, [rules, sessionId]);

  // Re-run AI analysis on sample rows (supports identifyMore)
  const handleRefreshAiSuggestions = async (identifyMore: boolean = false) => {
    setIsAiSuggesting(true);
    try {
      const res: any = await apiV2.refreshAiSuggestedRules(sessionId, identifyMore);
      const items = Array.isArray(res) ? res : (res?.ai_suggested_rules || []);
      const unmapped = (items || []).filter(
        (s: Rule2Item) =>
          !rules.some(
            (r) =>
              r.id === s.id ||
              (s.canonical_concept && r.canonical_concept === s.canonical_concept) ||
              (r.gstr_column && s.gstr_column && r.gstr_column.toLowerCase() === s.gstr_column.toLowerCase())
          )
      );
      setAiSuggestedRules(unmapped);
    } catch (e) {
      console.error("Failed to refresh AI suggestions:", e);
    } finally {
      setIsAiSuggesting(false);
    }
  };

  // User accepts an AI suggested rule into the active reconciliation pipeline PERMANENTLY
  const handleAcceptAiSuggestedRule = async (suggestedRule: Rule2Item) => {
    const acceptedRule: Rule2Item = {
      ...suggestedRule,
      is_enabled: true,
      is_ai_suggested: true,
      category: "AI_SUGGESTED",
      execution_order: rules.length + 1,
    };
    const nextRules = [...rules, acceptedRule];
    setRules(nextRules);

    // Remove from suggestions list immediately
    setAiSuggestedRules((prev) =>
      prev.filter(
        (r) =>
          r.id !== suggestedRule.id &&
          (!suggestedRule.canonical_concept || r.canonical_concept !== suggestedRule.canonical_concept)
      )
    );
    setExpandedRuleIds((prev) => new Set(prev).add(acceptedRule.id));

    // 1. Immediately persist to session localStorage and master Rules Wiki 2.0 catalog
    try {
      localStorage.setItem(`tars_v2_rules_${sessionId || "active"}`, JSON.stringify(nextRules));
      const masterSaved = localStorage.getItem("tars_master_rules_v2_catalog");
      let masterRules: Rule2Item[] = masterSaved ? JSON.parse(masterSaved) : [];
      if (!masterRules.some((m) => m.id === acceptedRule.id || (acceptedRule.canonical_concept && m.canonical_concept === acceptedRule.canonical_concept))) {
        masterRules.push(acceptedRule);
        localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(masterRules));
      }
    } catch {}

    // 2. Immediately post to backend session and mirror to persistent master catalog
    try {
      if (sessionId) {
        await apiV2.acceptRuleV2(sessionId, acceptedRule);
        await apiV2.confirmRulesV2(sessionId, nextRules);
      }
    } catch (e) {
      console.warn("Could not sync accepted rule to backend session:", e);
    }
  };

  // User dismisses an AI suggested rule
  const handleDismissAiSuggestedRule = (ruleId: string) => {
    setAiSuggestedRules((prev) => prev.filter((r) => r.id !== ruleId));
  };

  // Memoized unmapped suggestions: strictly deduplicated against active pipeline rules
  const unmappedSuggestions = useMemo(() => {
    return aiSuggestedRules.filter(
      (s) =>
        !rules.some(
          (r) =>
            r.id === s.id ||
            (s.canonical_concept && r.canonical_concept && r.canonical_concept.toLowerCase().trim() === s.canonical_concept.toLowerCase().trim()) ||
            (r.gstr_column && s.gstr_column && r.gstr_column.toLowerCase().trim() === s.gstr_column.toLowerCase().trim() &&
             r.pr_column && s.pr_column && r.pr_column.toLowerCase().trim() === s.pr_column.toLowerCase().trim()) ||
            (r.name && s.name && r.name.toLowerCase().trim() === s.name.toLowerCase().trim())
        )
    );
  }, [aiSuggestedRules, rules]);

  const handleAbortSimulation = () => {
    isExplicitAbortRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSimulating(false);
    setSimulationAborted(true);
  };

  const runSimulation = async (rulesToSimulate = rules) => {
    isExplicitAbortRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSimulating(true);
    setSimulationAborted(false);
    setSimStep(1);
    const startTime = Date.now();

    const stepTimer = setInterval(() => {
      setSimElapsedMs(Date.now() - startTime);
      setSimStep((prev) => (prev < 5 ? prev + 1 : prev));
    }, 350);

    try {
      const res = await apiV2.simulateRulesV2(sessionId, rulesToSimulate, controller.signal);
      setSimulationResult(res);
      setSimulationAborted(false);
    } catch (err: any) {
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        if (isExplicitAbortRef.current) {
          console.log("Simulation explicitly aborted by user.");
          setSimulationAborted(true);
        }
      } else {
        console.error("Simulation failed:", err);
      }
    } finally {
      clearInterval(stepTimer);
      setIsSimulating(false);
      abortControllerRef.current = null;
    }
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("text/plain", index.toString());
    e.dataTransfer.effectAllowed = "move";
    setDraggedIdx(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    const dragIdxStr = e.dataTransfer.getData("text/plain");
    const dragIdx = parseInt(dragIdxStr, 10);
    if (isNaN(dragIdx) || dragIdx === dropIdx) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }

    const newRules = [...rules];
    const [draggedItem] = newRules.splice(dragIdx, 1);
    newRules.splice(dropIdx, 0, draggedItem);

    const reordered = newRules.map((r, i) => ({ ...r, execution_order: i + 1 }));
    setRules(reordered);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // Rule toggle (NO auto-simulation)
  const handleToggleRule = (id: string) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r));
    setRules(updated);
  };

  // Rule micro-reordering (NO auto-simulation)
  const handleMoveRule = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= rules.length) return;

    const newRules = [...rules];
    const temp = newRules[index];
    newRules[index] = newRules[targetIdx];
    newRules[targetIdx] = temp;

    const reordered = newRules.map((r, i) => ({ ...r, execution_order: i + 1 }));
    setRules(reordered);
  };

  // Tolerance updates (NO auto-simulation)
  const handleUpdateNumericTol = (id: string, val: number, mode?: NumericToleranceMode) => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        return {
          ...r,
          tolerance_value: Math.max(0, val),
          ...(mode ? { tolerance_mode: mode } : {}),
        };
      }
      return r;
    });
    setRules(updated);
  };

  const handleUpdateDateTol = (id: string, val: number, unit?: DateToleranceUnit) => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        return {
          ...r,
          date_tolerance_value: Math.max(0, val),
          ...(unit ? { date_tolerance_unit: unit } : {}),
        };
      }
      return r;
    });
    setRules(updated);
  };

  const handleToggleNormalizer = (id: string, norm: NormalizationType) => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        const has = r.normalizers.includes(norm);
        const newNorms = has ? r.normalizers.filter((n) => n !== norm) : [...r.normalizers, norm];
        return { ...r, normalizers: newNorms };
      }
      return r;
    });
    setRules(updated);
  };

  const handleSetMatchMode = (id: string, mode: "EXACT" | "TOLERANCE") => {
    const updated = rules.map((r) => {
      if (r.id === id) {
        const isDateRule = r.strategy === "DATE_PROXIMITY" || r.id === "RW2-003" || r.id === "RW2-006";
        if (mode === "EXACT") {
          return {
            ...r,
            tolerance_value: 0,
            date_tolerance_value: 0,
          };
        } else {
          return {
            ...r,
            tolerance_value: r.tolerance_value > 0 ? r.tolerance_value : 10.0,
            date_tolerance_value: r.date_tolerance_value > 0 ? r.date_tolerance_value : 30,
            tolerance_mode: r.tolerance_mode || "ABSOLUTE_INR",
            date_tolerance_unit: r.date_tolerance_unit || "DAYS",
            strategy: (isDateRule ? "DATE_PROXIMITY" : (r.strategy === "VALUE_GUARD" ? "VALUE_GUARD" : "NUMERIC_TOLERANCE")) as MatchStrategy,
          };
        }
      }
      return r;
    });
    setRules(updated);
  };


  // AI Rule Compilation (NO auto-simulation)
  const handleCompileAi = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiCompiling(true);
    setAiError(null);
    try {
      const res = await apiV2.compileAiRule(aiPrompt.trim(), prColumns);
      setCompiledPreview(res);
    } catch (err: any) {
      setAiError(err.message || "Failed to compile AI rule.");
    } finally {
      setIsAiCompiling(false);
    }
  };

  const handleAddCompiledRule = () => {
    if (!compiledPreview) return;
    const newRule: Rule2Item = {
      ...compiledPreview,
      is_enabled: true,
      is_custom: true,
      execution_order: rules.length + 1,
    };
    const updated = [...rules, newRule];
    setRules(updated);
    try {
      localStorage.setItem(`tars_v2_rules_${sessionId || "active"}`, JSON.stringify(updated));
      const masterSaved = localStorage.getItem("tars_master_rules_v2_catalog");
      let masterRules: Rule2Item[] = masterSaved ? JSON.parse(masterSaved) : [];
      if (!masterRules.some((m) => m.id === newRule.id || (newRule.canonical_concept && m.canonical_concept === newRule.canonical_concept))) {
        masterRules.push(newRule);
        localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(masterRules));
      }
    } catch {}
    if (sessionId) {
      apiV2.acceptRuleV2(sessionId, newRule).catch(console.error);
      apiV2.confirmRulesV2(sessionId, updated).catch(console.error);
    }
    setCompiledPreview(null);
    setAiPrompt("");
    setShowAiModal(false);
  };

  // Final Confirmation & Proceed
  const handleProceed = async () => {
    setIsConfirming(true);
    try {
      await apiV2.confirmRulesV2(sessionId, rules);

      // Sync active rules into master Rules Wiki 2.0 catalog storage
      try {
        const masterSaved = localStorage.getItem("tars_master_rules_v2_catalog");
        let masterRules: Rule2Item[] = masterSaved ? JSON.parse(masterSaved) : [];
        for (const r of rules) {
          if (r.is_custom || r.is_ai_suggested) {
            if (!masterRules.some((m) => m.id === r.id || (r.canonical_concept && m.canonical_concept === r.canonical_concept))) {
              masterRules.push(r);
            }
          }
        }
        localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(masterRules));
      } catch {}

      const activeIds = rules.filter((r) => r.is_enabled).map((r) => r.id);
      const orderIds = rules.map((r) => r.id);
      onProceedToResults(activeIds, orderIds);
    } catch (err) {
      console.error("Failed to confirm rules:", err);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="v2-rules-container">
      {/* 1. Header Banner */}
      <header className="v2-rules-header">
        <div className="v2-rules-header__info">
          <span className="v2-rules-eyebrow">
            <Sliders size={13} />
            Stage 3 of 6: Reconciliation Rules Engine
          </span>
          <h1 className="v2-rules-title">Configure Reconciliation Rules</h1>
          <p className="v2-rules-subtitle">
            Select and prioritize the exact matching rules and tolerances to run for this session.
            Click <strong>"Explain Rule"</strong> on any rule card to review its columns and accounting rationale.
          </p>
        </div>

        <div className="v2-rules-header__actions">
          <button
            type="button"
            className="btn-ai-sparkle"
            style={{
              background: "linear-gradient(135deg, #4338ca, #6366f1)",
              color: "#ffffff",
              boxShadow: "0 2px 6px rgba(67, 56, 202, 0.3)",
            }}
            onClick={() => {
              const el = document.getElementById("v2-ai-suggestions-anchor");
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
            title="View AI Suggested Rules synthesized from workbook data nuances"
          >
            <Sparkles size={16} />
            <span>AI Suggested Rules ({aiSuggestedRules.length})</span>
          </button>

          <button
            type="button"
            className="btn-ai-sparkle"
            onClick={() => {
              setAiPrompt("");
              setCompiledPreview(null);
              setAiError(null);
              setShowAiModal(true);
            }}
          >
            <Sparkles size={16} />
            <span>Make Rules with AI</span>
          </button>

          <button
            type="button"
            className="btn-sim-run"
            disabled={isSimulating}
            onClick={() => runSimulation()}
          >
            <Play size={15} fill="currentColor" />
            <span>{isSimulating ? "Simulating..." : "Simulate"}</span>
          </button>
        </div>
      </header>

      {/* Top Stage Action Bar */}
      <ReconciliationV2ActionBar
        position="top"
        stageNumber={3}
        backLabel="Back to Schema Mapping"
        onBack={onBackToMapping}
        nextLabel={isConfirming ? "Freezing Rules…" : "Confirm & Freeze Rules"}
        onNext={handleProceed}
        nextDisabled={isConfirming || rules.filter((r) => r.is_enabled).length === 0}
        isNextLoading={isConfirming}
        nextLoadingText="Freezing Rules…"
      />

      {/* Agentic Simulation Deep Dive Console HUD */}
      {isSimulating && (
        <div className="v2-agentic-loading-screen" style={{ margin: "16px 0" }}>
          <div className="v2-agentic-loading-hud">
            <div className="v2-hud-top-ribbon">
              <div className="v2-hud-brand">
                <Sparkles size={14} />
                <span>AGENTIC MATCHING ENGINE DEEP DIVE TELEMETRY</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="v2-hud-timer-badge">
                  <Activity size={12} className="spin" />
                  {simElapsedMs} ms
                </span>
                <button
                  type="button"
                  className="btn-abort-sim"
                  onClick={handleAbortSimulation}
                  title="Click to cancel active simulation run immediately"
                >
                  <StopCircle size={14} />
                  <span>Abort Simulation</span>
                </button>
              </div>
            </div>

            <div className="v2-hud-heading">
              <h3>Simulating Matching Pipeline Across Datasets...</h3>
              <p>Real-time execution telemetry of deterministic matching passes, normalizations, and commercial tolerances.</p>
            </div>

            <div className="v2-hud-steps">
              <div className={`v2-hud-step-card ${simStep === 1 ? "active" : simStep > 1 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">01</span>
                  <div>
                    <div className="v2-hud-step-title">Ingesting & Canonicalizing Datasets</div>
                    <div className="v2-hud-step-desc">Loading Tax Authority Ledger (GSTR-2B) and Client ERP Purchase Register</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep > 1 ? "completed" : "running"}`}>
                  {simStep > 1 ? "COMPLETED" : "RUNNING..."}
                </span>
              </div>

              <div className={`v2-hud-step-card ${simStep === 2 ? "active" : simStep > 2 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">02</span>
                  <div>
                    <div className="v2-hud-step-title">Applying Column Normalizers</div>
                    <div className="v2-hud-step-desc">Cleaning whitespace, stripping special symbols, trimming leading zeros, case folding</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep > 2 ? "completed" : simStep === 2 ? "running" : ""}`}>
                  {simStep > 2 ? "COMPLETED" : simStep === 2 ? "RUNNING..." : "WAITING"}
                </span>
              </div>

              <div className={`v2-hud-step-card ${simStep === 3 ? "active" : simStep > 3 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">03</span>
                  <div>
                    <div className="v2-hud-step-title">Executing Sequential Waterfall Pipeline</div>
                    <div className="v2-hud-step-desc">Evaluating {rules.filter((r) => r.is_enabled).length} active rules in drag sequence</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep > 3 ? "completed" : simStep === 3 ? "running" : ""}`}>
                  {simStep > 3 ? "COMPLETED" : simStep === 3 ? "RUNNING..." : "WAITING"}
                </span>
              </div>

              <div className={`v2-hud-step-card ${simStep === 4 ? "active" : simStep > 4 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">04</span>
                  <div>
                    <div className="v2-hud-step-title">Evaluating Commercial Tolerances</div>
                    <div className="v2-hud-step-desc">Computing date lag windows and percentage/INR amount variance boundaries</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep > 4 ? "completed" : simStep === 4 ? "running" : ""}`}>
                  {simStep > 4 ? "COMPLETED" : simStep === 4 ? "RUNNING..." : "WAITING"}
                </span>
              </div>

              <div className={`v2-hud-step-card ${simStep === 5 ? "active" : simStep > 5 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">05</span>
                  <div>
                    <div className="v2-hud-step-title">Synthesizing Match Telemetry & Breakdown</div>
                    <div className="v2-hud-step-desc">Aggregating simultaneous match rates and rule satisfaction percentages</div>
                  </div>
                </div>
                <span className={`v2-hud-step-badge ${simStep === 5 ? "running" : ""}`}>
                  {simStep === 5 ? "FINALIZING..." : "WAITING"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Aborted Banner */}
      {simulationAborted && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, padding: "12px 18px", color: "#991b1b", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AlertTriangle size={18} />
            <span>Simulation run was aborted. Click "Simulate" to run a new simulation when ready.</span>
          </div>
          <button
            type="button"
            onClick={() => setSimulationAborted(false)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#991b1b", padding: 2 }}
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 2. Simulation HUD — Deep Navy Blue Card */}
      {simulationResult && !isSimulating && (
        <section className="v2-simulation-hud-card">
          <div className="v2-sim-hud-top">
            <span className="v2-sim-badge">
              <Sparkles size={12} />
              LIVE ENGINE SIMULATION TELEMETRY
            </span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Deterministic Financial Evidence · Instant Re-Evaluation Across Checked Rules
            </span>
          </div>

          <div className="v2-kpi-grid">
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Government (GSTR-2B)</span>
              <span className="v2-kpi-num">{simulationResult.total_gstr_rows.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#64748b" }}>Tax Authority Ledger</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Purchase Register</span>
              <span className="v2-kpi-num">{simulationResult.total_pr_rows.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#64748b" }}>Client Accounting ERP</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Simultaneous Matches</span>
              <span className="v2-kpi-num green">{simulationResult.total_matched.toLocaleString()}</span>
              <small style={{ fontSize: 11, color: "#34d399" }}>Across all checked rules concurrently</small>
            </div>
            <div className="v2-kpi-box">
              <span className="v2-kpi-label">Overall Match Rate</span>
              <span className="v2-kpi-num green">{simulationResult.overall_match_rate}%</span>
              <small style={{ fontSize: 11, color: "#34d399" }}>
                {simulationResult.total_unmatched_gstr.toLocaleString()} Gov rows remaining
              </small>
            </div>
          </div>

          {/* Multi-Color Stacked Progress Bar */}
          <div className="v2-waterfall-bar-wrap">
            <div className="v2-stacked-bar">
              {simulationResult.rule_breakdowns.map((bd, i) => {
                const colors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#14b8a6"];
                const color = colors[i % colors.length];
                const widthPct = simulationResult.total_gstr_rows > 0
                  ? (bd.individual_satisfied_count / simulationResult.total_gstr_rows) * 100 / simulationResult.rule_breakdowns.length
                  : 0;
                return (
                  <div
                    key={bd.rule_id}
                    style={{
                      width: `${Math.min(100, Math.max(8, widthPct))}%`,
                      background: color,
                      height: "100%",
                      transition: "width 0.3s ease",
                    }}
                    title={`${bd.rule_name}: ${bd.individual_satisfied_count.toLocaleString()} rows (${bd.individual_satisfied_percentage}%)`}
                  />
                );
              })}
              {simulationResult.total_unmatched_gstr > 0 && (
                <div
                  className="v2-bar-unmatched"
                  style={{
                    width: `${Math.max(2, (simulationResult.total_unmatched_gstr / simulationResult.total_gstr_rows) * 100)}%`,
                    height: "100%",
                  }}
                  title={`Unmatched: ${simulationResult.total_unmatched_gstr.toLocaleString()} rows`}
                />
              )}
            </div>

            <div className="v2-bar-legend">
              {simulationResult.rule_breakdowns.map((bd, i) => {
                const colors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#14b8a6"];
                const color = colors[i % colors.length];
                return (
                  <div key={bd.rule_id} className="v2-legend-item">
                    <span className="v2-legend-dot" style={{ background: color }} />
                    <span>
                      {bd.rule_name.split("(")[0].trim()}: <strong>{bd.individual_satisfied_count.toLocaleString()}</strong> ({bd.individual_satisfied_percentage}%)
                    </span>
                  </div>
                );
              })}
              <div className="v2-legend-item">
                <span className="v2-legend-dot" style={{ background: "rgba(255,255,255,0.25)" }} />
                <span>Unmatched: {simulationResult.total_unmatched_gstr.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 2.5 Dedicated Section: AI Suggested Rules (Contextual Intelligence) - Always Visible */}
      <section id="v2-ai-suggestions-anchor" className="v2-ai-suggestions-section">
        <div className="v2-ai-suggestions-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 9,
                background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
                color: "#ffffff",
                boxShadow: "0 2px 6px rgba(124, 58, 237, 0.3)",
                flexShrink: 0,
              }}
            >
              <Sparkles size={18} />
            </span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: "#1e1b4b" }}>
                  ✨ AI Suggested Rules (Contextual Intelligence)
                </h3>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: unmappedSuggestions.length > 0 ? "#6d28d9" : "#059669",
                    background: unmappedSuggestions.length > 0 ? "#ede9fe" : "#d1fae5",
                    padding: "2px 8px",
                    borderRadius: 12,
                  }}
                >
                  {unmappedSuggestions.length > 0 ? `${unmappedSuggestions.length} Available` : "All Columns Identified"}
                </span>
              </div>
              <p style={{ margin: "3px 0 0 0", fontSize: 12.5, color: "#4b5563" }}>
                {unmappedSuggestions.length > 0
                  ? `TARS studied sample rows from both workbooks and synthesized ${unmappedSuggestions.length} contextual rule recommendations based on your data schema. Review each rule and choose whether to accept it into your active reconciliation pipeline.`
                  : "All standard and contextual columns detected in your uploaded dataset are actively mapped to rules in your pipeline."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleRefreshAiSuggestions(unmappedSuggestions.length === 0)}
            disabled={isAiSuggesting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#6d28d9",
              background: "#ffffff",
              border: "1.5px solid #ddd6fe",
              padding: "7px 15px",
              borderRadius: 8,
              cursor: isAiSuggesting ? "not-allowed" : "pointer",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              flexShrink: 0,
            }}
          >
            <Sparkles size={14} className={isAiSuggesting ? "spin" : ""} />
            {isAiSuggesting ? "Analyzing Sample Rows..." : unmappedSuggestions.length > 0 ? "Re-Analyze Sample Rows" : "Scan Deep with AI"}
          </button>
        </div>

        {unmappedSuggestions.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
            {unmappedSuggestions.map((sugRule) => (
              <div key={sugRule.id} className="v2-ai-suggestion-card">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          color: "#6d28d9",
                          background: "#ede9fe",
                          padding: "2px 8px",
                          borderRadius: 4,
                          letterSpacing: "0.03em",
                        }}
                      >
                        {sugRule.category.replaceAll("_", " ")}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#1e1b4b" }}>
                        {sugRule.name}
                      </span>
                      <span className="v2-source-pill-compact" style={{ margin: 0 }}>
                        <strong className="gov">{sugRule.gstr_column}</strong>
                        <span style={{ color: "#94a3b8" }}>⟷</span>
                        <strong className="pr">{sugRule.pr_column}</strong>
                      </span>
                    </div>

                    <p style={{ margin: "0 0 8px 0", fontSize: 12.5, color: "#374151", lineHeight: 1.5 }}>
                      {sugRule.description}
                    </p>

                    {/* AI Rationale / Observation callout */}
                    {sugRule.ai_rationale && (
                      <div className="v2-ai-rationale-box">
                        <Sparkles size={14} style={{ color: "#7c3aed", marginTop: 2, flexShrink: 0 }} />
                        <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                          <strong style={{ color: "#5b21b6" }}>AI Contextual Observation: </strong>
                          <span>{sugRule.ai_rationale}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "center", flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn-add-ai-rule"
                      onClick={() => handleAcceptAiSuggestedRule(sugRule)}
                      title="Adopt this AI rule into the active reconciliation pipeline"
                    >
                      <Check size={14} /> Accept & Add to Pipeline
                    </button>
                    <button
                      type="button"
                      className="btn-dismiss-ai-rule"
                      onClick={() => handleDismissAiSuggestedRule(sugRule.id)}
                      title="Dismiss this suggestion"
                    >
                      <X size={14} /> Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="v2-all-identified-card">
            <div className="v2-all-identified-content">
              <div className="v2-all-identified-icon-badge">
                <CheckCircle2 size={22} />
              </div>
              <div>
                <h4 className="v2-all-identified-heading">
                  The columns you are trying to identify are already there. Would you like to identify more?
                </h4>
                <p className="v2-all-identified-text">
                  All standard and contextual columns detected in your uploaded dataset (such as GSTIN, Document Number, Date, Values, Place of Supply, HSN/SAC, Trade Name, and Cess) are actively mapped to rules in your pipeline.
                </p>
              </div>
            </div>
            <div className="v2-all-identified-actions">
              <button
                type="button"
                className="btn-identify-more"
                onClick={() => handleRefreshAiSuggestions(true)}
                disabled={isAiSuggesting}
              >
                <Sparkles size={15} className={isAiSuggesting ? "spin" : ""} />
                {isAiSuggesting ? "Scanning Sample Data with AI..." : "✨ Identify More with AI"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 3. Rules List */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Reconciliation Pipeline Rules ({rules.filter((r) => r.is_enabled).length} of {rules.length} selected)
          </h2>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Drag handle <GripVertical size={13} style={{ display: "inline", verticalAlign: "middle" }} /> to reorder execution priority. Uncheck to exclude rules.
          </span>
        </div>

        {rules.map((rule, idx) => {
          const isDate = rule.strategy === "DATE_PROXIMITY" || rule.id === "RW2-003" || rule.id === "RW2-006";
          const isExactMatch = isDate ? rule.date_tolerance_value === 0 : rule.tolerance_value === 0;
          const stat = simulationResult?.rule_breakdowns.find((b) => b.rule_id === rule.id);

          const isExpanded = expandedRuleIds.has(rule.id);

          return (
            <div
              key={rule.id}
              id={`v2-rule-card-${rule.id}`}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={`v2-rule-item-card ${!rule.is_enabled ? "disabled" : ""} ${isExpanded ? "is-expanded" : ""} ${rule.is_ai_suggested ? "is-ai-suggested-rule" : ""} ${draggedIdx === idx ? "dragging" : ""}`}
              style={{
                background: !rule.is_enabled ? "#f8fafc" : "#ffffff",
                borderColor: dragOverIdx === idx ? "#2563eb" : isExpanded ? "#93c5fd" : rule.is_enabled ? "#cbd5e1" : "#e2e8f0",
                opacity: draggedIdx === idx ? 0.4 : rule.is_enabled ? 1 : 0.78,
              }}
            >
              {/* Compact Main Row */}
              <div
                className="v2-rule-compact-row"
                onClick={() => toggleRuleExpand(rule.id)}
                title={isExpanded ? "Click to collapse details" : "Click to expand configuration & details"}
              >
                {/* Left: Drag Grip, Checkbox, Priority, Category, Name */}
                <div className="v2-rule-compact-left">
                  <div
                    className="v2-drag-grip"
                    title="Drag to reorder rule execution sequence"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical size={16} />
                  </div>

                  <input
                    type="checkbox"
                    checked={rule.is_enabled}
                    onChange={() => handleToggleRule(rule.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 17, height: 17, cursor: "pointer" }}
                    title={rule.is_enabled ? "Click to exclude rule" : "Click to include rule"}
                  />

                  <span className="v2-wf-tier-tag" style={{ fontSize: 10.5, padding: "2px 7px" }}>
                    #{idx + 1}
                  </span>

                  {/* Rule Tier Badge */}
                  {rule.rule_tier === "CORE_STATUTORY" && (
                    <span className="v2-tier-badge statutory" title="Mandatory statutory anchor under CGST Act & Rules">
                      <ShieldCheck size={11} /> Core Statutory
                    </span>
                  )}
                  {rule.rule_tier === "AUXILIARY_METADATA" && (
                    <span className="v2-tier-badge auxiliary" title="Auxiliary metadata rule (discrepancy flag / low yield risk)">
                      <Info size={11} /> Extra Metadata
                    </span>
                  )}
                  {(!rule.rule_tier || rule.rule_tier === "COMMERCIAL_POLICY") && (
                    <span className="v2-tier-badge commercial" title="Configurable commercial policy rule">
                      <Sliders size={11} /> Commercial
                    </span>
                  )}

                  {/* Statutory Reference Pill */}
                  {rule.statutory_reference && (
                    <span className="v2-statutory-pill" title={`Statutory Legal Authority: ${rule.statutory_reference}`}>
                      {rule.statutory_reference}
                    </span>
                  )}

                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: "#475569",
                      background: "#f1f5f9",
                      padding: "2px 7px",
                      borderRadius: 4,
                      letterSpacing: "0.02em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {rule.category.replaceAll("_", " ")}
                  </span>

                  <h3 className="v2-rule-name-text">
                    {rule.name}
                  </h3>
                </div>

                {/* Middle: Column Mapping & Parameter Summary */}
                <div className="v2-rule-compact-mid">
                  <span className="v2-source-pill-compact" title={`Matched columns: ${rule.gstr_column} ⟷ ${rule.pr_column}`}>
                    <strong className="gov">{rule.gstr_column}</strong>
                    <span style={{ color: "#94a3b8" }}>⟷</span>
                    <strong className="pr">{rule.pr_column}</strong>
                  </span>

                  {/* Missing Column Notice Badge */}
                  {rule.column_status === "MISSING" && (
                    <span
                      className="v2-missing-col-badge"
                      title={rule.missing_reason || "Required column missing in dataset"}
                    >
                      <AlertTriangle size={11} style={{ flexShrink: 0 }} />
                      <span>{rule.missing_reason || "Missing Column"}</span>
                    </span>
                  )}

                  {/* AI Suggested Rule Origin Tag */}
                  {rule.is_ai_suggested && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#6d28d9",
                        background: "#f3e8ff",
                        border: "1px solid #d8b4fe",
                        padding: "2px 7px",
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Adopted from AI Suggested Rules"
                    >
                      <Sparkles size={11} /> AI Suggested
                    </span>
                  )}

                  {/* Parameter Summary Badge */}
                  {isExactMatch ? (
                    <span className="v2-param-badge" style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }} title="Exact match (0 variance)">
                      Exact Match
                    </span>
                  ) : isDate ? (
                    <span className="v2-param-badge date" title="Date tolerance parameter">
                      ± {rule.date_tolerance_value} {rule.date_tolerance_unit.toLowerCase()}
                    </span>
                  ) : (
                    <span className="v2-param-badge numeric" title="Numeric tolerance parameter">
                      ± {rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value}`}
                    </span>
                  )}
                  <span className="v2-param-badge" title="Active normalization rules count">
                    {rule.normalizers.length} normalizer{rule.normalizers.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Right: Simulation Match Stats, Reorder buttons, Expand Chevron */}
                <div className="v2-rule-compact-right">
                  {simulationResult && rule.is_enabled && stat && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "3px 8px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "#047857",
                        background: "#ecfdf5",
                        border: "1px solid #a7f3d0",
                        borderRadius: 6,
                        whiteSpace: "nowrap",
                      }}
                      title="Actual 1-to-1 matches and percentage for this rule"
                    >
                      <CheckCircle2 size={12} color="#10b981" />
                      <span>
                        <strong>{stat.individual_satisfied_count.toLocaleString()}</strong> ({stat.individual_satisfied_percentage}%)
                      </span>
                    </div>
                  )}
                  {simulationResult && !rule.is_enabled && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 500,
                        color: "#64748b",
                        background: "#f1f5f9",
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span>Excluded</span>
                    </div>
                  )}

                  {/* Up / Down Reorder */}
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="v2-rule-card-order-btn"
                      disabled={idx === 0}
                      onClick={() => handleMoveRule(idx, "up")}
                      title="Move up in execution priority"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="v2-rule-card-order-btn"
                      disabled={idx === rules.length - 1}
                      onClick={() => handleMoveRule(idx, "down")}
                      title="Move down in execution priority"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>

                  {/* Expand/Collapse Chevron Button */}
                  <button
                    type="button"
                    className={`v2-expand-chevron-btn ${isExpanded ? "expanded" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRuleExpand(rule.id);
                    }}
                    title={isExpanded ? "Collapse ancillary details" : "Expand ancillary details"}
                  >
                    <ChevronDown size={15} />
                  </button>
                </div>
              </div>

              {/* Word of Caution Banner for Disabled Core Statutory Rules */}
              {rule.rule_tier === "CORE_STATUTORY" && !rule.is_enabled && (
                <div className="v2-word-of-caution-box" onClick={(e) => e.stopPropagation()}>
                  <div className="v2-caution-header">
                    <AlertTriangle size={15} className="v2-caution-icon" />
                    <strong>Word of Caution (Core Statutory Rule Excluded):</strong>
                  </div>
                  <p className="v2-caution-desc">
                    {rule.advisory_caution ||
                      `'${rule.name}' is a primary statutory anchor under ${rule.statutory_reference || "Section 16"}. Excluding this rule allows unanchored cross-vendor matching and exposes ITC claims to audit inquiry (Form DRC-01C).`}
                  </p>
                  <button
                    type="button"
                    className="btn-re-enable-statutory"
                    onClick={() => handleToggleRule(rule.id)}
                    title="Click to re-include this core statutory rule in reconciliation"
                  >
                    <Check size={12} /> Re-include Rule
                  </button>
                </div>
              )}

              {/* Match Yield Advisory for Enabled Auxiliary Metadata Rules */}
              {rule.rule_tier === "AUXILIARY_METADATA" && rule.is_enabled && (
                <div className="v2-yield-notice-box" onClick={(e) => e.stopPropagation()}>
                  <Info size={14} style={{ color: "#4338ca", flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 12, color: "#312e81", lineHeight: 1.45 }}>
                    <strong>Match Yield Advisory: </strong>
                    <span>
                      {rule.advisory_caution ||
                        "Auxiliary metadata column. Formatting variances between ERP and portal may reduce your overall match rate."}
                    </span>
                  </div>
                </div>
              )}

              {/* Expanded Ancillary Drawer */}
              {isExpanded && (
                <div className="v2-rule-expanded-drawer" onClick={(e) => e.stopPropagation()}>
                  {/* Missing Column Notice Banner */}
                  {rule.column_status === "MISSING" && (
                    <div
                      style={{
                        background: "#fffbeb",
                        border: "1px solid #fcd34d",
                        borderRadius: 8,
                        padding: "9px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: 12.5,
                        color: "#92400e",
                        marginBottom: 12,
                      }}
                    >
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                      <span>
                        <strong>Column Availability Notice:</strong> {rule.missing_reason || "This rule has been deselected by default because required column(s) were missing or unpopulated in your uploaded workbook."}
                      </span>
                    </div>
                  )}

                  {/* AI Contextual Observation Banner */}
                  {rule.ai_rationale && (
                    <div className="v2-ai-rationale-box" style={{ marginBottom: 12 }}>
                      <Sparkles size={14} style={{ color: "#7c3aed", marginTop: 2, flexShrink: 0 }} />
                      <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                        <strong style={{ color: "#5b21b6" }}>AI Contextual Observation: </strong>
                        <span>{rule.ai_rationale}</span>
                      </div>
                    </div>
                  )}

                  {/* Top of Drawer: Description, Canonical Concept, Explain Rule Button */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                    <div>
                      <p style={{ fontSize: 13, color: "#475569", margin: "0 0 4px 0", lineHeight: 1.45 }}>
                        {rule.description}
                      </p>
                      {rule.canonical_concept && (
                        <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
                          Canonical concept: <code>{rule.canonical_concept}</code>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setExplainingRule(rule)}
                      className="v2-browse-button"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#1d4ed8",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 7,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      title="View plain-English explanation, target columns & accounting rationale"
                    >
                      <Info size={14} />
                      <span>Explain Rule</span>
                    </button>
                  </div>

                  {/* Unified 2 Sections */}
                  <div className="v2-rule-sections-wrapper">
                    {/* SECTION 1: NORMALISERS */}
                    <div className="v2-rule-section-block">
                      <div className="v2-rule-section-header">
                        <span className="v2-rule-section-title">
                          Section 1: Normalisers
                        </span>
                        <span className="v2-rule-section-count">
                          {rule.normalizers.length} active
                        </span>
                      </div>
                      <div className="v2-norm-chips-wrap">
                        {ALL_NORMALIZERS.map((norm) => {
                          const isActive = rule.normalizers.includes(norm.type);
                          return (
                            <button
                              key={norm.type}
                              type="button"
                              className={`v2-norm-chip ${isActive ? "is-active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleNormalizer(rule.id, norm.type);
                              }}
                              title={norm.description}
                            >
                              {isActive && <CheckCircle2 size={12} />}
                              <span>{norm.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* SECTION 2: EXACT MATCH & TOLERANCE MATCH */}
                    <div className="v2-rule-section-block">
                      <div className="v2-rule-section-header">
                        <span className="v2-rule-section-title">
                          Section 2: Exact match & Tolerance match
                        </span>
                      </div>

                      <div className="v2-match-mode-selector">
                        <button
                          type="button"
                          className={`v2-mode-pill ${isExactMatch ? "is-active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetMatchMode(rule.id, "EXACT");
                          }}
                        >
                          <CheckCircle2 size={13} />
                          <span>Exact Match</span>
                        </button>
                        <button
                          type="button"
                          className={`v2-mode-pill ${!isExactMatch ? "is-active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetMatchMode(rule.id, "TOLERANCE");
                          }}
                        >
                          <Sliders size={13} />
                          <span>Tolerance Match</span>
                        </button>
                      </div>

                      {isExactMatch ? (
                        <div className="v2-exact-mode-info">
                          <CheckCircle2 size={14} color="#059669" />
                          <span>Strict 1-to-1 Equality: Permitting 0.00 variance after normalisation.</span>
                        </div>
                      ) : (
                        <div className="v2-tolerance-control-group">
                          <span className="v2-tolerance-input-label">Permitted Variance:</span>
                          <div className="v2-tolerance-inputs-row">
                            {/* Small text box in front to input the value */}
                            <input
                              type="number"
                              min={0}
                              step={!isDate && rule.tolerance_mode === "PERCENTAGE" ? 0.1 : 1}
                              className="v2-input-number"
                              value={isDate ? rule.date_tolerance_value : rule.tolerance_value}
                              onChange={(e) => {
                                e.stopPropagation();
                                const val = parseFloat(e.target.value) || 0;
                                if (isDate) {
                                  handleUpdateDateTol(rule.id, Math.round(val));
                                } else {
                                  handleUpdateNumericTol(rule.id, val);
                                }
                              }}
                            />

                            {/* Dropdown with options */}
                            {isDate ? (
                              <select
                                className="v2-select-mode"
                                value={rule.date_tolerance_unit}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleUpdateDateTol(rule.id, rule.date_tolerance_value, e.target.value as DateToleranceUnit);
                                }}
                              >
                                <option value="DAYS">Absolute Days</option>
                                <option value="MONTHS">Months</option>
                                <option value="YEARS">Years</option>
                              </select>
                            ) : (
                              <select
                                className="v2-select-mode"
                                value={rule.tolerance_mode}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleUpdateNumericTol(rule.id, rule.tolerance_value, e.target.value as NumericToleranceMode);
                                }}
                              >
                                <option value="ABSOLUTE_INR">Absolute Amount</option>
                                <option value="PERCENTAGE">Percentage</option>
                              </select>
                            )}

                            <span className="v2-tolerance-formula-hint">
                              {isDate
                                ? `(Matches if date difference does not exceed ± ${rule.date_tolerance_value} ${rule.date_tolerance_unit.toLowerCase()})`
                                : `(Matches if |GSTR - PR| does not exceed ${rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value}`})`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* 4. Bottom Action Bar */}
      <ReconciliationV2ActionBar
        position="bottom"
        stageNumber={3}
        backLabel="Back to Schema Mapping"
        onBack={onBackToMapping}
        nextLabel={isConfirming ? "Freezing Rules…" : "Confirm & Freeze Rules"}
        onNext={handleProceed}
        nextDisabled={isConfirming || rules.filter((r) => r.is_enabled).length === 0}
        isNextLoading={isConfirming}
        nextLoadingText="Freezing Rules…"
      />

      {/* --- PLAIN ENGLISH EXPLANATION MODAL --- */}
      {explainingRule && (
        <div className="v2-modal-backdrop" onClick={() => setExplainingRule(null)}>
          <div className="v2-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div>
                <span className="v2-rules-eyebrow" style={{ marginBottom: 6 }}>
                  {explainingRule.category.replaceAll("_", " ")}
                </span>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  {explainingRule.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setExplainingRule(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="v2-modal-body">
              <div className="v2-explain-section">
                <span className="v2-explain-label">Plain-English Rule Explanation</span>
                <div className="v2-explain-box">
                  {explainingRule.plain_english_explanation}
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Columns Evaluated Across Datasets</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#f1f5f9", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>TAX AUTHORITY LEDGER (GSTR-2B)</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {explainingRule.gstr_column}
                    </div>
                  </div>
                  <div style={{ background: "#ecfdf5", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#047857", fontWeight: 600 }}>CLIENT ACCOUNTING LEDGER (PR)</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#065f46", marginTop: 4 }}>
                      {explainingRule.pr_column}
                    </div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Accounting & Regulatory Rationale (Why It Matters)</span>
                <div className="v2-explain-box rationale">
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>{explainingRule.why_it_matters}</div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Active Comparison Parameters</span>
                <div style={{ fontSize: 12.5, color: "#475569", background: "#f8fafc", padding: "10px 14px", borderRadius: 8 }}>
                  {explainingRule.strategy === "DATE_PROXIMITY" && (
                    <span>
                      Window: ± <strong>{explainingRule.date_tolerance_value} {explainingRule.date_tolerance_unit.toLowerCase()}</strong>
                    </span>
                  )}
                  {explainingRule.strategy === "NUMERIC_TOLERANCE" && (
                    <span>
                      Variance: ± <strong>{explainingRule.tolerance_mode === "PERCENTAGE" ? `${explainingRule.tolerance_value}%` : `₹ ${explainingRule.tolerance_value}`}</strong>
                    </span>
                  )}
                  {explainingRule.strategy === "NORMALIZED_TEXT" && (
                    <span>
                      Active Normalizers: <strong>{explainingRule.normalizers.join(", ")}</strong>
                    </span>
                  )}
                  {explainingRule.strategy === "VALUE_GUARD" && (
                    <span>Strict flag identity (forward charge vs reverse charge)</span>
                  )}
                  {explainingRule.strategy === "EXACT" && (
                    <span>100% byte-for-byte exact value match</span>
                  )}
                </div>
              </div>
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="btn-primary-v2"
                style={{ padding: "8px 18px", fontSize: 13 }}
                onClick={() => setExplainingRule(null)}
              >
                Close Explanation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MAKE RULES WITH AI MODAL --- */}
      {showAiModal && (
        <div className="v2-modal-backdrop" onClick={() => setShowAiModal(false)}>
          <div className="v2-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Sparkles size={20} color="#2563eb" />
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Make Rules with AI
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="v2-modal-body">
              <p style={{ fontSize: 13.5, color: "#475569", margin: 0 }}>
                Describe your reconciliation policy in plain English. The agent will compile your instruction into a validated declarative rule.
              </p>

              <div>
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Allow invoice date variance of up to 15 days, or allow 1% tolerance on taxable value..."
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 13.5,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              </div>

              {/* Prompt Suggestions */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", alignSelf: "center" }}>
                  Try:
                </span>
                {[
                  "Invoice date must match exactly in both excels",
                  "Invoice amount should match",
                  "Allow invoice date variance of 15 days",
                  "Allow 2% tolerance on taxable value",
                  "Strict reverse charge mechanism alignment",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setAiPrompt(suggestion)}
                    style={{
                      background: "#f1f5f9",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 11.5,
                      color: "#334155",
                      cursor: "pointer",
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              {aiError && (
                <div style={{ color: "#ef4444", fontSize: 12.5, background: "#fef2f2", padding: "8px 12px", borderRadius: 6 }}>
                  {aiError}
                </div>
              )}

              {/* Preview of Compiled Rule */}
              {compiledPreview && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#166534", fontWeight: 700, fontSize: 13 }}>
                    <CheckCircle2 size={16} />
                    <span>Compiled Declarative Rule: {compiledPreview.name}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: "#166534", marginTop: 4, marginBottom: 8 }}>
                    {compiledPreview.plain_english_explanation}
                  </p>
                  <div style={{ fontSize: 11.5, color: "#15803d" }}>
                    Columns: <strong>{compiledPreview.gstr_column}</strong> ⟷ <strong>{compiledPreview.pr_column}</strong>
                  </div>
                </div>
              )}
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => setShowAiModal(false)}
              >
                Cancel
              </button>

              {!compiledPreview ? (
                <button
                  type="button"
                  className="btn-primary-v2"
                  disabled={isAiCompiling || !aiPrompt.trim()}
                  onClick={handleCompileAi}
                >
                  {isAiCompiling ? "Compiling with AI..." : "Compile Rule"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary-v2"
                  onClick={handleAddCompiledRule}
                >
                  Add Rule to Pipeline
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
