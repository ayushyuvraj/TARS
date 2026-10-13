import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  apiV2,
  Rule2Item,
  SimulationResultV2,
  DateToleranceUnit,
  NumericToleranceMode,
  NormalizationType,
  MatchStrategy,
} from "./api_v2";
import {
  apiV3,
  Rule3Item,
  configToActiveNormalizers,
  toggleNormalizerInConfig,
} from "./api_v3";
import {
  apiV4,
  Rule4Item,
  configToActiveNormalizersV4,
  toggleNormalizerInConfigV4,
} from "./api_v4";
import {
  apiV5,
  Rule5Item,
  configToActiveNormalizersV5,
  toggleNormalizerInConfigV5,
} from "./api_v5";
import {
  Play,
  ChevronDown,
  Info,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  X,
  StopCircle,
  Activity,
  Trash2,
  Edit3,
  User,
  Layers,
  Sparkles,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import "./rules_v2.css";
import "./reconciliation_v2.css";
import "./results_v2.css";

const ALL_NORMALIZERS: { type: NormalizationType; label: string; description?: string }[] = [
  { type: "TRIM_WHITESPACE", label: "Clean Spaces", description: "Trim leading and trailing whitespace" },
  { type: "STRIP_SPECIAL_CHARS", label: "Strip Symbols (+, -, /, _)", description: "Strip punctuation and delimiter symbols" },
  { type: "REMOVE_PREFIXES", label: "Strip Prefixes (INV, BILL)", description: "Strip standard document prefixes like INV or BILL" },
  { type: "TRIM_LEADING_ZEROS", label: "Trim Leading Zeros (0042 → 42)", description: "Remove leading zeroes from numeric identifiers" },
  { type: "UPPERCASE", label: "Case Fold (A-Z)", description: "Normalize letters to uppercase" },
];

function formatAuditDate(iso?: string | null): string {
  if (!iso) return "Initial Baseline";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export const RulesWikiV2: React.FC = () => {
  const navigate = useNavigate();
  const [reconMode, setReconMode] = useState<"v2" | "v3" | "v4" | "v5">("v5");
  const [rules, setRules] = useState<Rule2Item[]>([]);
  const [rulesV3, setRulesV3] = useState<Rule3Item[]>([]);
  const [rulesV4, setRulesV4] = useState<Rule4Item[]>([]);
  const [selectedRuleV4Ids, setSelectedRuleV4Ids] = useState<Set<string>>(new Set());
  const [expandedRuleV4Ids, setExpandedRuleV4Ids] = useState<Set<string>>(new Set());
  const [explainingRuleV4, setExplainingRuleV4] = useState<Rule4Item | null>(null);
  const [editingRuleV4, setEditingRuleV4] = useState<Rule4Item | null>(null);
  const [editFormV4, setEditFormV4] = useState<Rule4Item | null>(null);
  const [deleteModalStateV4, setDeleteModalStateV4] = useState<{
    isOpen: boolean;
    ruleIds: string[];
    ruleName?: string;
  } | null>(null);

  const toggleRuleExpandV4 = (ruleId: string) => {
    setExpandedRuleV4Ids((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  const [rulesV5, setRulesV5] = useState<Rule5Item[]>([]);
  const [selectedRuleV5Ids, setSelectedRuleV5Ids] = useState<Set<string>>(new Set());
  const [expandedRuleV5Ids, setExpandedRuleV5Ids] = useState<Set<string>>(new Set());
  const [explainingRuleV5, setExplainingRuleV5] = useState<Rule5Item | null>(null);
  const [editingRuleV5, setEditingRuleV5] = useState<Rule5Item | null>(null);
  const [editFormV5, setEditFormV5] = useState<Rule5Item | null>(null);
  const [deleteModalStateV5, setDeleteModalStateV5] = useState<{
    isOpen: boolean;
    ruleIds: string[];
    ruleName?: string;
  } | null>(null);

  const toggleRuleExpandV5 = (ruleId: string) => {
    setExpandedRuleV5Ids((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResultV2 | null>(null);
  const [simulationAborted, setSimulationAborted] = useState<boolean>(false);

  // Multi-select & Batch Deletion state
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());

  // Irreversible Caution Delete Modal state
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    ruleIds: string[];
    ruleName?: string;
  } | null>(null);

  // Edit Rule Modal state
  const [editingRule, setEditingRule] = useState<Rule2Item | null>(null);
  const [editForm, setEditForm] = useState<Rule2Item | null>(null);

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

  // Explanation Modal state
  const [explainingRule, setExplainingRule] = useState<Rule2Item | null>(null);

  // V3 Multi-select & Batch Deletion state
  const [selectedRuleV3Ids, setSelectedRuleV3Ids] = useState<Set<string>>(new Set());

  // V3 Irreversible Caution Delete Modal state
  const [deleteModalStateV3, setDeleteModalStateV3] = useState<{
    isOpen: boolean;
    ruleIds: string[];
    ruleName?: string;
  } | null>(null);

  // V3 Edit Rule Modal state
  const [editingRuleV3, setEditingRuleV3] = useState<Rule3Item | null>(null);
  const [editFormV3, setEditFormV3] = useState<Rule3Item | null>(null);

  // V3 Expanded Rule details state
  const [expandedRuleV3Ids, setExpandedRuleV3Ids] = useState<Set<string>>(new Set());

  const toggleRuleExpandV3 = (ruleId: string) => {
    setExpandedRuleV3Ids((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  // V3 Explanation Modal state
  const [explainingRuleV3, setExplainingRuleV3] = useState<Rule3Item | null>(null);

  // Load master catalog on mount with cross-storage synchronization
  const loadMasterCatalog = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiV2.getRules2Catalog();

      let merged = [...(data || [])];
      try {
        // 1. Check local master storage
        const masterSaved = localStorage.getItem("tars_master_rules_v2_catalog");
        if (masterSaved) {
          const parsedMaster: Rule2Item[] = JSON.parse(masterSaved);
          for (const r of parsedMaster) {
            if (!merged.some((m) => m.id === r.id || (r.canonical_concept && m.canonical_concept === r.canonical_concept))) {
              merged.push(r);
            }
          }
        }
        // 2. Check active session rules across localStorage
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("tars_v2_rules_")) {
            const raw = localStorage.getItem(key);
            if (raw) {
              const sessionRules: Rule2Item[] = JSON.parse(raw);
              for (const sr of sessionRules) {
                if (
                  !sr.is_temporary && sr.scope !== "temporary" &&
                  (sr.is_custom || sr.is_ai_suggested || sr.category === "AI_SUGGESTED") &&
                  !merged.some((m) => m.id === sr.id || (sr.canonical_concept && m.canonical_concept === sr.canonical_concept))
                ) {
                  merged.push(sr);
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn("Could not merge local rules into Rules Wiki 2.0:", e);
      }

      merged = merged
        .filter((r) => !r.is_temporary && r.scope !== "temporary")
        .map((r, idx) => ({
          ...r,
          execution_order: idx + 1,
          created_at: r.created_at || "2026-08-01T00:00:00Z",
          created_by: r.created_by || (r.is_ai_suggested ? "AI Data Engine (GPT-5.4-mini)" : "System Standard Baseline"),
          created_in_run: r.created_in_run || "Master Catalog v2.0",
          version: r.version || "1.0.0",
        }));

      setRules(merged);
      try {
        localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(merged));
      } catch {}

      if (data && merged.length > data.length) {
        apiV2.saveRules2Catalog(merged).catch(() => {});
      }

      try {
        try {
          const catalogV5 = await apiV5.getMasterRulesCatalog();
          const permV5 = (catalogV5 || []).filter((r: Rule5Item) => !r.is_temporary && r.scope !== "temporary");
          setRulesV5(permV5);
        } catch (e) {
          console.warn("Could not load V5 rules catalog:", e);
        }
        try {
          const catalogV4 = await apiV4.getMasterRulesCatalog();
          const permV4 = (catalogV4 || []).filter((r: Rule4Item) => !r.is_temporary && r.scope !== "temporary");
          setRulesV4(permV4);
        } catch (e) {
          console.warn("Could not load V4 rules catalog:", e);
        }
        const catalogV3 = await apiV3.getMasterRulesCatalog();
        const permV3 = (catalogV3 || []).filter((r) => !r.is_temporary && r.scope !== "temporary");
        setRulesV3(permV3);
      } catch (e) {
        console.warn("Could not load V3 rules catalog:", e);
      }
    } catch (err) {
      console.error("Failed to load Rules catalog:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMasterCatalog();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadMasterCatalog]);

  // Continuously persist any rule modifications to master catalog storage
  useEffect(() => {
    if (rules.length > 0) {
      try {
        localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(rules));
      } catch {}
    }
  }, [rules]);

  const isExplicitAbortRef = useRef<boolean>(false);

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
      if (reconMode === "v5") {
        const res = await apiV5.simulateRules(rulesV5);
        setSimulationResult(res);
        setSimulationAborted(false);
      } else {
        const res = await apiV2.simulateRulesV2("master-catalog-preview", rulesToSimulate, controller.signal);
        setSimulationResult(res);
        setSimulationAborted(false);
      }
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

  // Selection handlers
  const handleToggleSelectRule = (id: string) => {
    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedRuleIds.size === rules.length) {
      setSelectedRuleIds(new Set());
    } else {
      setSelectedRuleIds(new Set(rules.map((r) => r.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedRuleIds(new Set());
  };

  // Rule toggle active state (NO auto-simulation)
  const handleToggleRule = (id: string) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r));
    setRules(updated);
  };

  // Tolerance updates
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

  // Delete Prompt
  const promptDeleteSingle = (rule: Rule2Item) => {
    setDeleteModalState({
      isOpen: true,
      ruleIds: [rule.id],
      ruleName: rule.name,
    });
  };

  const promptDeleteBatch = () => {
    if (selectedRuleIds.size === 0) return;
    setDeleteModalState({
      isOpen: true,
      ruleIds: Array.from(selectedRuleIds),
    });
  };

  // Perform Delete after explicit confirmation of irreversible caution
  const handleConfirmDelete = async () => {
    if (!deleteModalState || deleteModalState.ruleIds.length === 0) return;
    const idsToDelete = new Set(deleteModalState.ruleIds);

    try {
      if (deleteModalState.ruleIds.length === 1) {
        await apiV2.deleteRuleFromCatalog(deleteModalState.ruleIds[0]);
      } else {
        await apiV2.batchDeleteRulesFromCatalog(deleteModalState.ruleIds);
      }
    } catch (err) {
      console.warn("Backend delete endpoint notice (fallback to local state):", err);
    }

    const updatedRules = rules.filter((r) => !idsToDelete.has(r.id));
    setRules(updatedRules);

    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      for (const id of idsToDelete) {
        next.delete(id);
      }
      return next;
    });

    try {
      localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(updatedRules));
    } catch {}

    setDeleteModalState(null);
  };

  // Edit Rule Handlers
  const handleStartEdit = (rule: Rule2Item) => {
    setEditingRule(rule);
    setEditForm({ ...rule });
  };

  const handleSaveEdit = () => {
    if (!editForm || !editingRule) return;

    const now = new Date().toISOString();
    const updatedRule: Rule2Item = {
      ...editForm,
      last_modified_at: now,
      last_modified_by: "Tax Reviewer (Manual Edit)",
      version: editForm.version ? incrementVersion(editForm.version) : "1.1.0",
    };

    const updatedList = rules.map((r) => (r.id === editingRule.id ? updatedRule : r));
    setRules(updatedList);

    try {
      localStorage.setItem("tars_master_rules_v2_catalog", JSON.stringify(updatedList));
    } catch {}

    apiV2.saveRules2Catalog(updatedList).catch(console.error);
    setEditingRule(null);
    setEditForm(null);
  };

  const incrementVersion = (v: string): string => {
    const parts = v.split(".");
    if (parts.length === 3) {
      const patch = parseInt(parts[2], 10);
      if (!isNaN(patch)) {
        return `${parts[0]}.${parts[1]}.${patch + 1}`;
      }
    }
    return `${v}.1`;
  };

  // V3 Rule toggle active state
  const handleToggleRuleV3 = (id: string) => {
    const updated = rulesV3.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r));
    setRulesV3(updated);
    try {
      localStorage.setItem("tars_master_rules_v3_catalog", JSON.stringify(updated));
    } catch {}
    apiV3.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleToggleSelectRuleV3 = (id: string) => {
    setSelectedRuleV3Ids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllV3 = () => {
    if (selectedRuleV3Ids.size === rulesV3.length) {
      setSelectedRuleV3Ids(new Set());
    } else {
      setSelectedRuleV3Ids(new Set(rulesV3.map((r) => r.id)));
    }
  };

  const handleClearSelectionV3 = () => {
    setSelectedRuleV3Ids(new Set());
  };

  const handleToggleNormalizerV3 = (id: string, normType: NormalizationType) => {
    const updated = rulesV3.map((r) => {
      if (r.id === id) {
        const nextNorms = toggleNormalizerInConfig(r.normalizers, normType);
        return { ...r, normalizers: nextNorms };
      }
      return r;
    });
    setRulesV3(updated);
    try {
      localStorage.setItem("tars_master_rules_v3_catalog", JSON.stringify(updated));
    } catch {}
    apiV3.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleSetMatchModeV3 = (id: string, mode: "EXACT" | "TOLERANCE") => {
    const updated = rulesV3.map((r) => {
      if (r.id === id) {
        const isDateRule = r.match_strategy === "DATE_PROXIMITY" || r.id === "R3-05" || r.canonical_concept === "invoice_date";
        if (mode === "EXACT") {
          return {
            ...r,
            match_strategy: "EXACT",
            tolerance_value: 0,
            date_tolerance_value: 0,
          };
        } else {
          return {
            ...r,
            match_strategy: isDateRule ? "DATE_PROXIMITY" : "NUMERIC_TOLERANCE",
            tolerance_value: r.tolerance_value && r.tolerance_value > 0 ? r.tolerance_value : 10.0,
            date_tolerance_value: r.date_tolerance_value && r.date_tolerance_value > 0 ? r.date_tolerance_value : 30,
            tolerance_mode: (r.tolerance_mode || "ABSOLUTE_INR") as "ABSOLUTE_INR" | "PERCENTAGE",
            date_tolerance_unit: (r.date_tolerance_unit || "DAYS") as "DAYS" | "MONTHS" | "YEARS",
          };
        }
      }
      return r;
    });
    setRulesV3(updated);
    try {
      localStorage.setItem("tars_master_rules_v3_catalog", JSON.stringify(updated));
    } catch {}
    apiV3.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleUpdateNumericTolV3 = (id: string, val: number, mode?: "ABSOLUTE_INR" | "PERCENTAGE") => {
    const updated = rulesV3.map((r) => {
      if (r.id === id) {
        return {
          ...r,
          tolerance_value: Math.max(0, val),
          ...(mode ? { tolerance_mode: mode } : {}),
        };
      }
      return r;
    });
    setRulesV3(updated);
    try {
      localStorage.setItem("tars_master_rules_v3_catalog", JSON.stringify(updated));
    } catch {}
    apiV3.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleUpdateDateTolV3 = (id: string, val: number, unit?: "DAYS" | "MONTHS" | "YEARS") => {
    const updated = rulesV3.map((r) => {
      if (r.id === id) {
        return {
          ...r,
          date_tolerance_value: Math.max(0, val),
          ...(unit ? { date_tolerance_unit: unit } : {}),
        };
      }
      return r;
    });
    setRulesV3(updated);
    try {
      localStorage.setItem("tars_master_rules_v3_catalog", JSON.stringify(updated));
    } catch {}
    apiV3.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const promptDeleteSingleV3 = (rule: Rule3Item) => {
    setDeleteModalStateV3({
      isOpen: true,
      ruleIds: [rule.id],
      ruleName: rule.name,
    });
  };

  const promptDeleteBatchV3 = () => {
    if (selectedRuleV3Ids.size === 0) return;
    setDeleteModalStateV3({
      isOpen: true,
      ruleIds: Array.from(selectedRuleV3Ids),
    });
  };

  const handleConfirmDeleteV3 = async () => {
    if (!deleteModalStateV3 || deleteModalStateV3.ruleIds.length === 0) return;
    const idsToDelete = new Set(deleteModalStateV3.ruleIds);
    const updatedRules = rulesV3.filter((r) => !idsToDelete.has(r.id));
    setRulesV3(updatedRules);
    setSelectedRuleV3Ids((prev) => {
      const next = new Set(prev);
      for (const id of idsToDelete) next.delete(id);
      return next;
    });
    try {
      localStorage.setItem("tars_master_rules_v3_catalog", JSON.stringify(updatedRules));
      await apiV3.updateMasterRulesCatalog(updatedRules);
    } catch {}
    setDeleteModalStateV3(null);
  };

  const handleStartEditV3 = (rule: Rule3Item) => {
    setEditingRuleV3(rule);
    setEditFormV3({ ...rule });
  };

    // --- V4 Handlers ---
  const handleToggleRuleV4 = (id: string) => {
    const updated = rulesV4.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r));
    setRulesV4(updated);
    apiV4.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleToggleSelectRuleV4 = (id: string) => {
    setSelectedRuleV4Ids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllV4 = () => {
    if (selectedRuleV4Ids.size === rulesV4.length) setSelectedRuleV4Ids(new Set());
    else setSelectedRuleV4Ids(new Set(rulesV4.map((r) => r.id)));
  };

  const handleToggleNormalizerV4 = (id: string, normType: any) => {
    const updated = rulesV4.map((r) => {
      if (r.id === id) {
        const nextNorms = toggleNormalizerInConfigV4(r.normalizers, normType);
        return { ...r, normalizers: nextNorms };
      }
      return r;
    });
    setRulesV4(updated);
    apiV4.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleSetMatchModeV4 = (id: string, mode: "EXACT" | "TOLERANCE") => {
    const updated = rulesV4.map((r) => {
      if (r.id === id) {
        const isDateRule = r.match_strategy === "DATE_PROXIMITY" || r.id === "R4-04" || r.id === "R4-05";
        if (mode === "EXACT") {
          return { ...r, match_strategy: "EXACT", tolerance_value: 0, date_tolerance_value: 0 };
        } else {
          return {
            ...r,
            match_strategy: isDateRule ? "DATE_PROXIMITY" : "NUMERIC_TOLERANCE",
            tolerance_value: r.tolerance_value && r.tolerance_value > 0 ? r.tolerance_value : 10.0,
            date_tolerance_value: r.date_tolerance_value && r.date_tolerance_value > 0 ? r.date_tolerance_value : 30,
          };
        }
      }
      return r;
    });
    setRulesV4(updated);
    apiV4.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleUpdateNumericTolV4 = (id: string, val: number, mode?: "ABSOLUTE_INR" | "PERCENTAGE") => {
    const updated = rulesV4.map((r) => (r.id === id ? { ...r, tolerance_value: Math.max(0, val), ...(mode ? { tolerance_mode: mode } : {}) } : r));
    setRulesV4(updated);
    apiV4.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleUpdateDateTolV4 = (id: string, val: number, unit?: "DAYS" | "MONTHS" | "YEARS") => {
    const updated = rulesV4.map((r) => (r.id === id ? { ...r, date_tolerance_value: Math.max(0, val), ...(unit ? { date_tolerance_unit: unit } : {}) } : r));
    setRulesV4(updated);
    apiV4.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleUpdateClientParamV4 = (id: string, updates: Partial<Rule4Item>) => {
    const updated = rulesV4.map((r) => (r.id === id ? { ...r, ...updates } : r));
    setRulesV4(updated);
    apiV4.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const promptDeleteSingleV4 = (rule: Rule4Item) => {
    setDeleteModalStateV4({
      isOpen: true,
      ruleIds: [rule.id],
      ruleName: rule.name,
    });
  };

  const handleConfirmDeleteV4 = async () => {
    if (!deleteModalStateV4 || deleteModalStateV4.ruleIds.length === 0) return;
    const idsToDelete = new Set(deleteModalStateV4.ruleIds);
    const updatedRules = rulesV4.filter((r) => !idsToDelete.has(r.id));
    setRulesV4(updatedRules);
    setSelectedRuleV4Ids((prev) => {
      const next = new Set(prev);
      for (const id of idsToDelete) next.delete(id);
      return next;
    });
    try {
      localStorage.setItem("tars_master_rules_v4_catalog", JSON.stringify(updatedRules));
      await apiV4.updateMasterRulesCatalog(updatedRules);
    } catch {}
    setDeleteModalStateV4(null);
  };

  const handleStartEditV4 = (rule: Rule4Item) => {
    setEditingRuleV4(rule);
    setEditFormV4({ ...rule });
  };

  const handleSaveEditV4 = async () => {
    if (!editFormV4 || !editingRuleV4) return;
    const updatedRule: Rule4Item = {
      ...editFormV4,
      version: editFormV4.version ? incrementVersion(editFormV4.version) : "1.1.0",
    };
    const updatedList = rulesV4.map((r) => (r.id === editingRuleV4.id ? updatedRule : r));
    setRulesV4(updatedList);
    try {
      localStorage.setItem("tars_master_rules_v4_catalog", JSON.stringify(updatedList));
      await apiV4.updateMasterRulesCatalog(updatedList);
    } catch {}
    setEditingRuleV4(null);
    setEditFormV4(null);
  };

  const handleSaveEditV3 = () => {
    if (!editFormV3 || !editingRuleV3) return;
    const updatedRule: Rule3Item = {
      ...editFormV3,
      version: editFormV3.version ? incrementVersion(editFormV3.version) : "1.1.0",
    };
    const updatedList = rulesV3.map((r) => (r.id === editingRuleV3.id ? updatedRule : r));
    setRulesV3(updatedList);
    try {
      localStorage.setItem("tars_master_rules_v3_catalog", JSON.stringify(updatedList));
    } catch {}
    apiV3.updateMasterRulesCatalog(updatedList).catch(console.error);
    setEditingRuleV3(null);
    setEditFormV3(null);
  };

  // --- V5 Handlers ---
  const handleToggleRuleV5 = (id: string) => {
    const updated = rulesV5.map((r) => (r.id === id ? { ...r, is_enabled: !r.is_enabled } : r));
    setRulesV5(updated);
    apiV5.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleToggleSelectRuleV5 = (id: string) => {
    setSelectedRuleV5Ids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllV5 = () => {
    if (selectedRuleV5Ids.size === rulesV5.length) setSelectedRuleV5Ids(new Set());
    else setSelectedRuleV5Ids(new Set(rulesV5.map((r) => r.id)));
  };

  const handleClearSelectionV5 = () => {
    setSelectedRuleV5Ids(new Set());
  };

  const handleToggleNormalizerV5 = (id: string, normType: any) => {
    const updated = rulesV5.map((r) => {
      if (r.id === id) {
        const nextNorms = toggleNormalizerInConfigV5(r.normalizers, normType);
        return { ...r, normalizers: nextNorms };
      }
      return r;
    });
    setRulesV5(updated);
    apiV5.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleSetMatchModeV5 = (id: string, mode: "EXACT" | "TOLERANCE") => {
    const updated = rulesV5.map((r) => {
      if (r.id === id) {
        const isDateRule = r.match_strategy === "DATE_PROXIMITY" || r.id === "R5-04" || r.id === "R5-05";
        if (mode === "EXACT") {
          return { ...r, match_strategy: "EXACT", tolerance_value: 0, date_tolerance_value: 0 };
        } else {
          return {
            ...r,
            match_strategy: isDateRule ? "DATE_PROXIMITY" : "NUMERIC_TOLERANCE",
            tolerance_value: r.tolerance_value && r.tolerance_value > 0 ? r.tolerance_value : 10.0,
            date_tolerance_value: r.date_tolerance_value && r.date_tolerance_value > 0 ? r.date_tolerance_value : 30,
          };
        }
      }
      return r;
    });
    setRulesV5(updated);
    apiV5.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleUpdateNumericTolV5 = (id: string, val: number, mode?: "ABSOLUTE_INR" | "PERCENTAGE") => {
    const updated = rulesV5.map((r) => (r.id === id ? { ...r, tolerance_value: Math.max(0, val), ...(mode ? { tolerance_mode: mode } : {}) } : r));
    setRulesV5(updated);
    apiV5.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleUpdateDateTolV5 = (id: string, val: number, unit?: "DAYS" | "MONTHS" | "YEARS") => {
    const updated = rulesV5.map((r) => (r.id === id ? { ...r, date_tolerance_value: Math.max(0, val), ...(unit ? { date_tolerance_unit: unit } : {}) } : r));
    setRulesV5(updated);
    apiV5.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const handleUpdateClientParamV5 = (id: string, updates: Partial<Rule5Item>) => {
    const updated = rulesV5.map((r) => (r.id === id ? { ...r, ...updates } : r));
    setRulesV5(updated);
    apiV5.updateMasterRulesCatalog(updated).catch(console.error);
  };

  const promptDeleteSingleV5 = (rule: Rule5Item) => {
    setDeleteModalStateV5({
      isOpen: true,
      ruleIds: [rule.id],
      ruleName: rule.name,
    });
  };

  const promptDeleteBatchV5 = () => {
    if (selectedRuleV5Ids.size === 0) return;
    setDeleteModalStateV5({
      isOpen: true,
      ruleIds: Array.from(selectedRuleV5Ids),
    });
  };

  const handleConfirmDeleteV5 = async () => {
    if (!deleteModalStateV5 || deleteModalStateV5.ruleIds.length === 0) return;
    const idsToDelete = new Set(deleteModalStateV5.ruleIds);
    const updatedRules = rulesV5.filter((r) => !idsToDelete.has(r.id));
    setRulesV5(updatedRules);
    setSelectedRuleV5Ids((prev) => {
      const next = new Set(prev);
      for (const id of idsToDelete) next.delete(id);
      return next;
    });
    try {
      localStorage.setItem("tars_master_rules_v5_catalog", JSON.stringify(updatedRules));
      await apiV5.updateMasterRulesCatalog(updatedRules);
    } catch {}
    setDeleteModalStateV5(null);
  };

  const handleStartEditV5 = (rule: Rule5Item) => {
    setEditingRuleV5(rule);
    setEditFormV5({ ...rule });
  };

  const handleSaveEditV5 = async () => {
    if (!editFormV5 || !editingRuleV5) return;
    const updatedRule: Rule5Item = {
      ...editFormV5,
      version: editFormV5.version ? incrementVersion(editFormV5.version) : "1.1.0",
    };
    const updatedList = rulesV5.map((r) => (r.id === editingRuleV5.id ? updatedRule : r));
    setRulesV5(updatedList);
    try {
      localStorage.setItem("tars_master_rules_v5_catalog", JSON.stringify(updatedList));
      await apiV5.updateMasterRulesCatalog(updatedList);
    } catch {}
    setEditingRuleV5(null);
    setEditFormV5(null);
  };

  return (
    <div className="v2-executive-root">
      {/* 1. TOP EXECUTIVE TELEMETRY RIBBON */}
      <div className="v2-telemetry-ribbon">
        <div className="v2-telemetry-left">
          <div className="v2-brand-pill">
            <div className="v2-brand-icon-halo">
              <SlidersHorizontal size={13} className="v2-rules-icon-spin" />
            </div>
            <span className="v2-brand-title">RULES WIKI</span>
          </div>
        </div>

        <div className="v2-telemetry-right">
          <div className="v2-agent-status-pill" title="Autonomous Agent Fabric Active">
            <span className="v2-status-dot-pulse" />
            <span>AGENT ACTIVE</span>
          </div>
        </div>
      </div>

      {/* 2. MAIN SCROLLABLE CANVAS */}
      <div className="v2-stage-canvas" style={{ padding: "16px 20px 24px 20px" }}>
        <div className="v2-rules-container">
          {/* 3. HERO BANNER (Unified Dark Royal Cobalt matching Stage 1 & Stage 4) */}
          <div className="v2-results-hero">
            <div className="v2-hero-nav-left">
              <button
                type="button"
                className="v2-hero-btn-back"
                onClick={() => navigate("/dashboard")}
                title="Return to Executive Dashboard"
                aria-label="Back to Dashboard"
              >
                <ArrowLeft size={15} />
                <span>Dashboard</span>
              </button>
            </div>

            <div className="v2-results-hero-content">
              <div className="v2-results-hero-title-row">
                <h2 className="v2-results-hero-title">Rules Wiki 2.0</h2>
                <div className="v2-results-stage-tag">
                  <ShieldCheck size={12} />
                  <span>Enterprise Governance Catalog</span>
                </div>
              </div>
              <p className="v2-results-hero-desc">
                Master repository of declarative business rules configured for real-world enterprise GST reconciliation. Audit provenance, inspect comparison logic, edit parameters, or manage catalog policies.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setReconMode("v5")}
                  style={{
                    background: reconMode === "v5" ? "#00338D" : "rgba(30, 41, 59, 0.7)",
                    color: reconMode === "v5" ? "#ffffff" : "#94a3b8",
                    border: reconMode === "v5" ? "1px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 8,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Double Ledger Updated (Recon 5.0)
                </button>
                <button
                  type="button"
                  onClick={() => setReconMode("v4")}
                  style={{
                    background: reconMode === "v4" ? "#00338D" : "rgba(30, 41, 59, 0.7)",
                    color: reconMode === "v4" ? "#ffffff" : "#94a3b8",
                    border: reconMode === "v4" ? "1px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 8,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Single Ledger Updated (Recon 4.0)
                </button>
                <button
                  type="button"
                  onClick={() => setReconMode("v3")}
                  style={{
                    background: reconMode === "v3" ? "#00338D" : "rgba(30, 41, 59, 0.7)",
                    color: reconMode === "v3" ? "#ffffff" : "#94a3b8",
                    border: reconMode === "v3" ? "1px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 8,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Intra-Table Rules (Recon 3.0)
                </button>
                <button
                  type="button"
                  onClick={() => setReconMode("v2")}
                  style={{
                    background: reconMode === "v2" ? "#00338D" : "rgba(30, 41, 59, 0.7)",
                    color: reconMode === "v2" ? "#ffffff" : "#94a3b8",
                    border: reconMode === "v2" ? "1px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 8,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Two-Table Rules (Recon 2.0)
                </button>
              </div>
            </div>

            <div className="v2-results-hero-actions">
              <button
                type="button"
                className="v2-btn-primary-action"
                disabled={isSimulating}
                onClick={() => runSimulation()}
                title="Simulate active rules against representative dataset"
              >
                <Play size={14} fill="currentColor" />
                <span>{isSimulating ? "Simulating..." : "Simulate"}</span>
              </button>
            </div>
          </div>

      {/* Floating Bulk Action Bar when rules are selected */}
      {((reconMode === "v5" && selectedRuleV5Ids.size > 0) || (reconMode === "v4" && selectedRuleV4Ids.size > 0) || (reconMode === "v3" && selectedRuleV3Ids.size > 0) || (reconMode === "v2" && selectedRuleIds.size > 0)) && (
        <div className="v2-bulk-bar">
          <div className="v2-bulk-info">
            <span className="v2-bulk-count-badge">
              {reconMode === "v5" ? selectedRuleV5Ids.size : reconMode === "v4" ? selectedRuleV4Ids.size : reconMode === "v3" ? selectedRuleV3Ids.size : selectedRuleIds.size}
            </span>
            <span>
              {(reconMode === "v5" ? selectedRuleV5Ids.size : reconMode === "v4" ? selectedRuleV4Ids.size : reconMode === "v3" ? selectedRuleV3Ids.size : selectedRuleIds.size) === 1
                ? "1 rule selected"
                : `${reconMode === "v5" ? selectedRuleV5Ids.size : reconMode === "v4" ? selectedRuleV4Ids.size : reconMode === "v3" ? selectedRuleV3Ids.size : selectedRuleIds.size} rules selected`}
            </span>
          </div>

          <div className="v2-bulk-actions">
            <button
              type="button"
              className="btn-bulk-clear"
              onClick={reconMode === "v5" ? handleClearSelectionV5 : reconMode === "v4" ? () => setSelectedRuleV4Ids(new Set()) : reconMode === "v3" ? handleClearSelectionV3 : handleClearSelection}
            >
              Clear Selection
            </button>
            <button
              type="button"
              className="btn-bulk-delete"
              onClick={reconMode === "v5" ? promptDeleteBatchV5 : reconMode === "v4" ? () => setDeleteModalStateV4({ isOpen: true, ruleIds: Array.from(selectedRuleV4Ids) }) : reconMode === "v3" ? promptDeleteBatchV3 : promptDeleteBatch}
            >
              <Trash2 size={14} />
              <span>Delete Selected ({reconMode === "v5" ? selectedRuleV5Ids.size : reconMode === "v4" ? selectedRuleV4Ids.size : reconMode === "v3" ? selectedRuleV3Ids.size : selectedRuleIds.size})</span>
            </button>
          </div>
        </div>
      )}

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
              <h3>Simulating Catalog Rules Across Benchmark Dataset...</h3>
              <p>Real-time execution telemetry of deterministic matching passes, normalizations, and commercial tolerances.</p>
            </div>

            <div className="v2-hud-steps">
              <div className={`v2-hud-step-card ${simStep === 1 ? "active" : simStep > 1 ? "completed" : ""}`}>
                <div className="v2-hud-step-left">
                  <span className="v2-hud-step-num">01</span>
                  <div>
                    <div className="v2-hud-step-title">Ingesting Benchmark Datasets</div>
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
                    <div className="v2-hud-step-desc">Evaluating {rules.filter((r) => r.is_enabled).length} active rules in sequence</div>
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
              <small style={{ fontSize: 11, color: "#34d399" }}>Across all active rules concurrently</small>
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

      {/* 3. Rules Catalog List */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {reconMode === "v5" ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155" }}>
                  <input
                    type="checkbox"
                    className="v2-card-select-checkbox"
                    checked={rulesV5.length > 0 && selectedRuleV5Ids.size === rulesV5.length}
                    onChange={handleToggleSelectAllV5}
                    title="Select all rules for bulk action"
                  />
                  <span>Select All</span>
                </label>
                <span style={{ color: "#94a3b8" }}>|</span>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Double Ledger Master Rules ({rulesV5.filter((r) => r.is_enabled).length} of {rulesV5.length} active)
                </h2>
              </div>

              <span style={{ fontSize: 12, color: "#64748b" }}>
                Click rule card to view/configure comparison parameters, client policy boundaries & audit metadata.
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rulesV5.map((rule, idx) => {
                const isDate = rule.match_strategy === "DATE_PROXIMITY" || rule.id === "R5-04" || rule.id === "R5-05" || rule.canonical_concept === "invoice_date" || rule.canonical_concept === "document_date";
                const isExactMatch = isDate ? (!rule.date_tolerance_value || rule.date_tolerance_value === 0) : (!rule.tolerance_value || rule.tolerance_value === 0);
                const activeNorms = configToActiveNormalizersV5(rule.normalizers);
                const isExpanded = expandedRuleV5Ids.has(rule.id);
                const isSelected = selectedRuleV5Ids.has(rule.id);

                return (
                  <div
                    key={rule.id}
                    id={`v5-rule-card-${rule.id}`}
                    className={`v2-rule-item-card ${!rule.is_enabled ? "disabled" : ""} ${isExpanded ? "is-expanded" : ""} ${isSelected ? "is-selected" : ""}`}
                  >
                    {/* Compact Main Row */}
                    <div
                      className="v2-rule-compact-row"
                      onClick={() => toggleRuleExpandV5(rule.id)}
                      title={isExpanded ? "Click to collapse details" : "Click to expand configuration & audit metadata"}
                    >
                      {/* Left: Checkbox for batch selection, Apple switch enable toggle, Order #, Category, Name */}
                      <div className="v2-rule-compact-left">
                        <input
                          type="checkbox"
                          className="v2-card-select-checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRuleV5(rule.id)}
                          onClick={(e) => e.stopPropagation()}
                          title={isSelected ? "Deselect rule" : "Select rule"}
                        />

                        <label
                          className="v2-apple-switch"
                          onClick={(e) => e.stopPropagation()}
                          title={rule.is_enabled ? "Rule is Active. Click to disable" : "Rule is Disabled. Click to enable"}
                        >
                          <input
                            type="checkbox"
                            checked={rule.is_enabled}
                            onChange={() => handleToggleRuleV5(rule.id)}
                          />
                          <span className="v2-apple-switch-slider" />
                        </label>

                        <span className="v2-rule-order-badge">
                          #{idx + 1}
                        </span>

                        <span className="v2-rule-category-pill">
                          {rule.category.replaceAll("_", " ")}
                        </span>

                        <h3 className="v2-rule-name-text">
                          {rule.name}
                        </h3>
                      </div>

                      {/* Middle: Column Mapping & Parameter Summary */}
                      <div className="v2-rule-compact-mid">
                        <span className="v2-source-pill-compact" title={`Matched columns: GSTR-2B (${rule.gstr_column}) ⟷ PR (${rule.pr_column})`}>
                          <strong className="gov">{rule.gstr_column}</strong>
                          <span style={{ color: "#94a3b8" }}>⟷</span>
                          <strong className="pr">{rule.pr_column}</strong>
                        </span>

                        {rule.rule_tier && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: "#1d4ed8",
                              background: "#eff6ff",
                              border: "1px solid #bfdbfe",
                              padding: "2px 7px",
                              borderRadius: 999,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                            title={`Seniority Waterfall: ${rule.rule_tier}`}
                          >
                            <ShieldCheck size={11} /> {rule.rule_tier}
                          </span>
                        )}

                        {rule.origin_session_id && (
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
                            title={`Adopted from session ${rule.origin_session_id}`}
                          >
                            <Sparkles size={11} /> Saved from Session
                          </span>
                        )}

                        {/* Parameter Summary Badge */}
                        {isExactMatch ? (
                          <span className="v2-param-badge" style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }} title="Exact match (0 variance)">
                            Exact Match
                          </span>
                        ) : isDate ? (
                          <span className="v2-param-badge date" title="Date tolerance parameter">
                            ± {rule.date_tolerance_value || 30} {(rule.date_tolerance_unit || "DAYS").toLowerCase()}
                          </span>
                        ) : (
                          <span className="v2-param-badge numeric" title="Numeric tolerance parameter">
                            ± {rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value || 10}`}
                          </span>
                        )}
                        <span className="v2-param-badge" title="Active normalization rules count">
                          {activeNorms.length} normalizer{activeNorms.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      {/* Right: Edit, Delete, Expand Chevron */}
                      <div className="v2-rule-compact-right">
                        <button
                          type="button"
                          className="v2-rule-action-btn edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEditV5(rule);
                          }}
                          title="Edit rule name, columns, tolerances, or rationale"
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          className="v2-rule-action-btn delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            promptDeleteSingleV5(rule);
                          }}
                          title="Delete rule permanently from catalog"
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>

                        <button
                          type="button"
                          className={`v2-expand-chevron-btn ${isExpanded ? "expanded" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRuleExpandV5(rule.id);
                          }}
                          title={isExpanded ? "Collapse ancillary details" : "Expand ancillary details"}
                        >
                          <ChevronDown size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Ancillary Drawer: 2-Column Mac Studio Pro Bento Layout */}
                    {isExpanded && (
                      <div className="v2-rule-expanded-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="v2-pro-grid-layout">
                          {/* LEFT COLUMN: Rule Intelligence, Rationale & Audit Lineage */}
                          <div className="v2-pro-intelligence-card">
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <div className="v2-pro-card-header">
                                <ShieldCheck size={14} />
                                <span>Rule Specification & Accounting Rationale</span>
                              </div>

                              <p className="v2-pro-desc">
                                {rule.description}
                              </p>

                              <div className="v2-pro-rationale-callout">
                                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                <div>
                                  <strong>Accounting Context:</strong> {rule.statutory_rationale || rule.why_it_matters || "Statutory reconciliation guardrail ensuring strict compliance with GST ITC claims."}
                                </div>
                              </div>

                              {rule.canonical_concept && (
                                <div className="v2-canonical-concept-chip">
                                  Canonical concept: <code>{rule.canonical_concept}</code>
                                </div>
                              )}
                            </div>

                            {/* Bottom Action & Audit Strip */}
                            <div className="v2-pro-lineage-footer">
                              <button
                                type="button"
                                onClick={() => setExplainingRuleV5(rule)}
                                className="v2-explain-pill-btn"
                                title="Click to view deep-dive plain-English explanation, target columns & statutory rationale"
                              >
                                <Sparkles size={13} />
                                <span>Explain Rule with AI</span>
                              </button>

                              <div className="v2-pro-lineage-meta">
                                <div className="v2-audit-item" title="Timestamp when this rule was created">
                                  <Clock size={11} color="#64748b" />
                                  <span>{formatAuditDate(rule.created_at)}</span>
                                </div>

                                <div className="v2-audit-item" title="Author or system agent that authored this rule">
                                  <User size={11} color="#64748b" />
                                  <span>{rule.created_by || "System Standard Baseline"}</span>
                                </div>

                                <span className={`v2-audit-badge ${rule.is_temporary ? "ai" : "system"}`}>
                                  v{rule.version || "1.0.0"}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* RIGHT COLUMN: Interactive Engine Controls (Normalizers + Match Policy) */}
                          <div className="v2-pro-controls-card">
                            {/* SECTION 1: NORMALISERS */}
                            <div className="v2-rule-section-block">
                              <div className="v2-rule-section-header">
                                <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                                  <Sliders size={13} />
                                  <span>Section 1: Normalisation Pipeline</span>
                                </div>
                                <span className="v2-rule-section-count">
                                  {activeNorms.length} active
                                </span>
                              </div>
                              <div className="v2-norm-chips-wrap">
                                {ALL_NORMALIZERS.map((norm) => {
                                  const isActive = activeNorms.includes(norm.type);
                                  return (
                                    <button
                                      key={norm.type}
                                      type="button"
                                      className={`v2-norm-chip ${isActive ? "is-active" : ""}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleNormalizerV5(rule.id, norm.type);
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
                                <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                                  <CheckCircle2 size={13} />
                                  <span>Section 2: Match Policy & Variance</span>
                                </div>
                              </div>

                              <div className="v2-match-mode-selector">
                                <button
                                  type="button"
                                  className={`v2-mode-pill ${isExactMatch ? "is-active" : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSetMatchModeV5(rule.id, "EXACT");
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
                                    handleSetMatchModeV5(rule.id, "TOLERANCE");
                                  }}
                                >
                                  <Sliders size={13} />
                                  <span>Tolerance Match</span>
                                </button>
                              </div>

                              {isExactMatch ? (
                                <div className="v2-exact-mode-info">
                                  <CheckCircle2 size={13} color="#059669" />
                                  <span>Strict 1-to-1 Equality: Permitting 0.00 variance after normalisation.</span>
                                </div>
                              ) : (
                                <div className="v2-tolerance-control-group">
                                  <span className="v2-tolerance-input-label">Permitted Variance:</span>
                                  <div className="v2-tolerance-inputs-row">
                                    <input
                                      type="number"
                                      min={0}
                                      step={!isDate && rule.tolerance_mode === "PERCENTAGE" ? 0.1 : 1}
                                      className="v2-input-number"
                                      value={isDate ? (rule.date_tolerance_value || 30) : (rule.tolerance_value || 10)}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        const val = parseFloat(e.target.value) || 0;
                                        if (isDate) {
                                          handleUpdateDateTolV5(rule.id, Math.round(val));
                                        } else {
                                          handleUpdateNumericTolV5(rule.id, val);
                                        }
                                      }}
                                    />

                                    {isDate ? (
                                      <select
                                        className="v2-select-mode"
                                        value={rule.date_tolerance_unit || "DAYS"}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleUpdateDateTolV5(rule.id, rule.date_tolerance_value || 30, e.target.value as "DAYS" | "MONTHS" | "YEARS");
                                        }}
                                      >
                                        <option value="DAYS">Absolute Days</option>
                                        <option value="MONTHS">Months</option>
                                        <option value="YEARS">Years</option>
                                      </select>
                                    ) : (
                                      <select
                                        className="v2-select-mode"
                                        value={rule.tolerance_mode || "ABSOLUTE_INR"}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleUpdateNumericTolV5(rule.id, rule.tolerance_value || 10, e.target.value as "ABSOLUTE_INR" | "PERCENTAGE");
                                        }}
                                      >
                                        <option value="ABSOLUTE_INR">Absolute Amount (INR)</option>
                                        <option value="PERCENTAGE">Percentage (%)</option>
                                      </select>
                                    )}

                                    <span className="v2-tolerance-formula-hint">
                                      {isDate
                                        ? `(± ${rule.date_tolerance_value || 30} ${(rule.date_tolerance_unit || "DAYS").toLowerCase()})`
                                        : `(|GSTR - PR| ≤ ${rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value || 10}%` : `₹${rule.tolerance_value || 10}`})`}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Section 3: Specialized Client Rule Controls */}
                            {(rule.cross_fy_enabled !== undefined || rule.min_threshold_ineligible !== undefined || rule.custom_date_range_days !== undefined || rule.id === "R5-06") && (
                              <div className="v2-rule-section-block">
                                <div className="v2-rule-section-header">
                                  <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                                    <ShieldCheck size={13} />
                                    <span>Section 3: Specialized Client Policy Parameters</span>
                                  </div>
                                </div>

                                {rule.cross_fy_enabled !== undefined && (
                                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, fontWeight: 600, color: "#1e293b", cursor: "pointer" }}>
                                      <input
                                        type="checkbox"
                                        checked={!!rule.cross_fy_enabled}
                                        onChange={(e) => handleUpdateClientParamV5(rule.id, { cross_fy_enabled: e.target.checked })}
                                      />
                                      <span>Cross-Financial Year Boundary Allowance (March 31 vs April 2)</span>
                                    </label>
                                  </div>
                                )}

                                {rule.min_threshold_ineligible !== undefined && (
                                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Section 17(5) Gap Threshold:</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>₹</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step={10}
                                        value={rule.min_threshold_ineligible ?? 100}
                                        onChange={(e) => handleUpdateClientParamV5(rule.id, { min_threshold_ineligible: parseFloat(e.target.value) || 0 })}
                                        className="v2-input-number"
                                        style={{ width: 85 }}
                                      />
                                    </div>
                                  </div>
                                )}

                                {rule.custom_date_range_days !== undefined && (
                                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Multi-Tranche Date Window:</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={rule.custom_date_range_days ?? 31}
                                        onChange={(e) => handleUpdateClientParamV5(rule.id, { custom_date_range_days: parseInt(e.target.value) || 31 })}
                                        className="v2-input-number"
                                        style={{ width: 75 }}
                                      />
                                      <span style={{ fontSize: 12, color: "#64748b" }}>Days</span>
                                    </div>
                                  </div>
                                )}

                                {rule.id === "R5-06" && (
                                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe", fontSize: 12, color: "#1e40af", display: "flex", alignItems: "center", gap: 8 }}>
                                    <Layers size={14} />
                                    <span>Batch Consolidation enabled: Automatically resolves multi-invoice batching (1:N and N:1) with constituent audit breakdown.</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : reconMode === "v4" ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155" }}>
                  <input
                    type="checkbox"
                    className="v2-card-select-checkbox"
                    checked={rulesV4.length > 0 && selectedRuleV4Ids.size === rulesV4.length}
                    onChange={handleToggleSelectAllV4}
                    title="Select all rules for bulk action"
                  />
                  <span>Select All</span>
                </label>
                <span style={{ color: "#94a3b8" }}>|</span>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Master Catalog Rules ({rulesV4.filter((r) => r.is_enabled).length} of {rulesV4.length} active)
                </h2>
              </div>

              <span style={{ fontSize: 12, color: "#64748b" }}>
                Click rule card to view/configure comparison parameters & audit metadata.
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rulesV4.map((rule, idx) => {
                const isDate = rule.match_strategy === "DATE_PROXIMITY" || rule.id === "R4-04" || rule.id === "R4-05" || rule.canonical_concept === "invoice_date" || rule.canonical_concept === "document_date";
                const isExactMatch = isDate ? (!rule.date_tolerance_value || rule.date_tolerance_value === 0) : (!rule.tolerance_value || rule.tolerance_value === 0);
                const activeNorms = configToActiveNormalizersV4(rule.normalizers);
                const isExpanded = expandedRuleV4Ids.has(rule.id);
                const isSelected = selectedRuleV4Ids.has(rule.id);

                return (
                  <div
                    key={rule.id}
                    id={`v4-rule-card-${rule.id}`}
                    className={`v2-rule-item-card ${!rule.is_enabled ? "disabled" : ""} ${isExpanded ? "is-expanded" : ""} ${isSelected ? "is-selected" : ""}`}
                  >
                    {/* Compact Main Row */}
                    <div
                      className="v2-rule-compact-row"
                      onClick={() => toggleRuleExpandV4(rule.id)}
                      title={isExpanded ? "Click to collapse details" : "Click to expand configuration & audit metadata"}
                    >
                      {/* Left: Checkbox for batch selection, Apple switch enable toggle, Order #, Category, Name */}
                      <div className="v2-rule-compact-left">
                        <input
                          type="checkbox"
                          className="v2-card-select-checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRuleV4(rule.id)}
                          onClick={(e) => e.stopPropagation()}
                          title={isSelected ? "Deselect rule" : "Select rule"}
                        />

                        <label
                          className="v2-apple-switch"
                          onClick={(e) => e.stopPropagation()}
                          title={rule.is_enabled ? "Rule is Active. Click to disable" : "Rule is Disabled. Click to enable"}
                        >
                          <input
                            type="checkbox"
                            checked={rule.is_enabled}
                            onChange={() => handleToggleRuleV4(rule.id)}
                          />
                          <span className="v2-apple-switch-slider" />
                        </label>

                        <span className="v2-rule-order-badge">
                          #{idx + 1}
                        </span>

                        <span className="v2-rule-category-pill">
                          {rule.category.replaceAll("_", " ")}
                        </span>

                        <h3 className="v2-rule-name-text">
                          {rule.name}
                        </h3>
                      </div>

                      {/* Middle: Column Mapping & Parameter Summary */}
                      <div className="v2-rule-compact-mid">
                        <span className="v2-source-pill-compact" title={`Matched columns: ${rule.source_field_concept} ⟷ ${rule.target_field_concept}`}>
                          <strong className="gov">{rule.source_field_concept}</strong>
                          <span style={{ color: "#94a3b8" }}>⟷</span>
                          <strong className="pr">{rule.target_field_concept}</strong>
                        </span>

                        {rule.origin_session_id && (
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
                            title={`Adopted from session ${rule.origin_session_id}`}
                          >
                            <Sparkles size={11} /> Saved from Session
                          </span>
                        )}

                        {/* Parameter Summary Badge */}
                        {isExactMatch ? (
                          <span className="v2-param-badge" style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }} title="Exact match (0 variance)">
                            Exact Match
                          </span>
                        ) : isDate ? (
                          <span className="v2-param-badge date" title="Date tolerance parameter">
                            ± {rule.date_tolerance_value || 30} {(rule.date_tolerance_unit || "DAYS").toLowerCase()}
                          </span>
                        ) : (
                          <span className="v2-param-badge numeric" title="Numeric tolerance parameter">
                            ± {rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value || 10}`}
                          </span>
                        )}
                        <span className="v2-param-badge" title="Active normalization rules count">
                          {activeNorms.length} normalizer{activeNorms.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      {/* Right: Edit, Delete, Expand Chevron */}
                      <div className="v2-rule-compact-right">
                        <button
                          type="button"
                          className="v2-rule-action-btn edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEditV4(rule);
                          }}
                          title="Edit rule name, columns, tolerances, or rationale"
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          className="v2-rule-action-btn delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            promptDeleteSingleV4(rule);
                          }}
                          title="Delete rule permanently from catalog"
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>

                        <button
                          type="button"
                          className={`v2-expand-chevron-btn ${isExpanded ? "expanded" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRuleExpandV4(rule.id);
                          }}
                          title={isExpanded ? "Collapse ancillary details" : "Expand ancillary details"}
                        >
                          <ChevronDown size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Ancillary Drawer: 2-Column Mac Studio Pro Bento Layout (Exact Recon 3.0) */}
                    {isExpanded && (
                      <div className="v2-rule-expanded-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="v2-pro-grid-layout">
                          {/* LEFT COLUMN: Rule Intelligence, Rationale & Audit Lineage */}
                          <div className="v2-pro-intelligence-card">
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <div className="v2-pro-card-header">
                                <ShieldCheck size={14} />
                                <span>Rule Specification & Rationale</span>
                              </div>

                              <p className="v2-pro-desc">
                                {rule.description}
                              </p>

                              <div className="v2-pro-rationale-callout">
                                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                <div>
                                  <strong>Accounting Context:</strong> {rule.statutory_rationale || rule.why_it_matters || "Statutory reconciliation guardrail ensuring strict compliance with GST ITC claims."}
                                </div>
                              </div>

                              {rule.canonical_concept && (
                                <div className="v2-canonical-concept-chip">
                                  Canonical concept: <code>{rule.canonical_concept}</code>
                                </div>
                              )}
                            </div>

                            {/* Bottom Action & Audit Strip */}
                            <div className="v2-pro-lineage-footer">
                              <button
                                type="button"
                                onClick={() => setExplainingRuleV4(rule)}
                                className="v2-explain-pill-btn"
                                title="Click to view deep-dive plain-English explanation, target columns & statutory rationale"
                              >
                                <Sparkles size={13} />
                                <span>Explain Rule with AI</span>
                              </button>

                              <div className="v2-pro-lineage-meta">
                                <div className="v2-audit-item" title="Timestamp when this rule was created">
                                  <Clock size={11} color="#64748b" />
                                  <span>{formatAuditDate(rule.created_at)}</span>
                                </div>

                                <div className="v2-audit-item" title="Author or system agent that authored this rule">
                                  <User size={11} color="#64748b" />
                                  <span>{rule.created_by || "System Standard Baseline"}</span>
                                </div>

                                <span className={`v2-audit-badge ${rule.is_temporary ? "ai" : "system"}`}>
                                  v{rule.version || "1.0.0"}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* RIGHT COLUMN: Interactive Engine Controls (Normalizers + Match Policy) */}
                          <div className="v2-pro-controls-card">
                            {/* SECTION 1: NORMALISERS */}
                            <div className="v2-rule-section-block">
                              <div className="v2-rule-section-header">
                                <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                                  <Sliders size={13} />
                                  <span>Section 1: Normalisation Pipeline</span>
                                </div>
                                <span className="v2-rule-section-count">
                                  {activeNorms.length} active
                                </span>
                              </div>
                              <div className="v2-norm-chips-wrap">
                                {ALL_NORMALIZERS.map((norm) => {
                                  const isActive = activeNorms.includes(norm.type);
                                  return (
                                    <button
                                      key={norm.type}
                                      type="button"
                                      className={`v2-norm-chip ${isActive ? "is-active" : ""}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleNormalizerV4(rule.id, norm.type);
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
                                <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                                  <CheckCircle2 size={13} />
                                  <span>Section 2: Match Policy & Variance</span>
                                </div>
                              </div>

                              <div className="v2-match-mode-selector">
                                <button
                                  type="button"
                                  className={`v2-mode-pill ${isExactMatch ? "is-active" : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSetMatchModeV4(rule.id, "EXACT");
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
                                    handleSetMatchModeV4(rule.id, "TOLERANCE");
                                  }}
                                >
                                  <Sliders size={13} />
                                  <span>Tolerance Match</span>
                                </button>
                              </div>

                              {isExactMatch ? (
                                <div className="v2-exact-mode-info">
                                  <CheckCircle2 size={13} color="#059669" />
                                  <span>Strict 1-to-1 Equality: Permitting 0.00 variance after normalisation.</span>
                                </div>
                              ) : (
                                <div className="v2-tolerance-control-group">
                                  <span className="v2-tolerance-input-label">Permitted Variance:</span>
                                  <div className="v2-tolerance-inputs-row">
                                    <input
                                      type="number"
                                      min={0}
                                      step={!isDate && rule.tolerance_mode === "PERCENTAGE" ? 0.1 : 1}
                                      className="v2-input-number"
                                      value={isDate ? (rule.date_tolerance_value || 30) : (rule.tolerance_value || 10)}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        const val = parseFloat(e.target.value) || 0;
                                        if (isDate) {
                                          handleUpdateDateTolV4(rule.id, Math.round(val));
                                        } else {
                                          handleUpdateNumericTolV4(rule.id, val);
                                        }
                                      }}
                                    />

                                    {isDate ? (
                                      <select
                                        className="v2-select-mode"
                                        value={rule.date_tolerance_unit || "DAYS"}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleUpdateDateTolV4(rule.id, rule.date_tolerance_value || 30, e.target.value as "DAYS" | "MONTHS" | "YEARS");
                                        }}
                                      >
                                        <option value="DAYS">Absolute Days</option>
                                        <option value="MONTHS">Months</option>
                                        <option value="YEARS">Years</option>
                                      </select>
                                    ) : (
                                      <select
                                        className="v2-select-mode"
                                        value={rule.tolerance_mode || "ABSOLUTE_INR"}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleUpdateNumericTolV4(rule.id, rule.tolerance_value || 10, e.target.value as "ABSOLUTE_INR" | "PERCENTAGE");
                                        }}
                                      >
                                        <option value="ABSOLUTE_INR">Absolute Amount (INR)</option>
                                        <option value="PERCENTAGE">Percentage (%)</option>
                                      </select>
                                    )}

                                    <span className="v2-tolerance-formula-hint">
                                      {isDate
                                        ? `(± ${rule.date_tolerance_value || 30} ${(rule.date_tolerance_unit || "DAYS").toLowerCase()})`
                                        : `(|CP - PR| ≤ ${rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value || 10}%` : `₹${rule.tolerance_value || 10}`})`}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Section 3: Specialized Client Rule Controls */}
                            {(rule.cross_fy_enabled !== undefined || rule.min_threshold_ineligible !== undefined || rule.custom_date_range_days !== undefined) && (
                              <div className="v2-rule-section-block">
                                <div className="v2-rule-section-header">
                                  <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                                    <ShieldCheck size={13} />
                                    <span>Section 3: Specialized Client Policy Parameters</span>
                                  </div>
                                </div>

                                {rule.cross_fy_enabled !== undefined && (
                                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, fontWeight: 600, color: "#1e293b", cursor: "pointer" }}>
                                      <input
                                        type="checkbox"
                                        checked={!!rule.cross_fy_enabled}
                                        onChange={(e) => handleUpdateClientParamV4(rule.id, { cross_fy_enabled: e.target.checked })}
                                      />
                                      <span>Cross-Financial Year Boundary Allowance (March 31 vs April 2)</span>
                                    </label>
                                  </div>
                                )}

                                {rule.min_threshold_ineligible !== undefined && (
                                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Section 17(5) Gap Threshold:</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>₹</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step={10}
                                        value={rule.min_threshold_ineligible ?? 100}
                                        onChange={(e) => handleUpdateClientParamV4(rule.id, { min_threshold_ineligible: parseFloat(e.target.value) || 0 })}
                                        className="v2-input-number"
                                        style={{ width: 85 }}
                                      />
                                    </div>
                                  </div>
                                )}

                                {rule.custom_date_range_days !== undefined && (
                                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Multi-Tranche Date Window:</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={rule.custom_date_range_days ?? 31}
                                        onChange={(e) => handleUpdateClientParamV4(rule.id, { custom_date_range_days: parseInt(e.target.value) || 31 })}
                                        className="v2-input-number"
                                        style={{ width: 75 }}
                                      />
                                      <span style={{ fontSize: 12, color: "#64748b" }}>Days</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : reconMode === "v3" ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155" }}>
                  <input
                    type="checkbox"
                    className="v2-card-select-checkbox"
                    checked={rulesV3.length > 0 && selectedRuleV3Ids.size === rulesV3.length}
                    onChange={handleToggleSelectAllV3}
                    title="Select all intra-table rules for bulk action"
                  />
                  <span>Select All</span>
                </label>
                <span style={{ color: "#94a3b8" }}>|</span>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Master Catalog Rules ({rulesV3.filter((r) => r.is_enabled).length} of {rulesV3.length} active)
                </h2>
              </div>

              <span style={{ fontSize: 12, color: "#64748b" }}>
                Click rule card to view/configure comparison parameters & audit metadata.
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rulesV3.map((rule, idx) => {
                const isDate = rule.match_strategy === "DATE_PROXIMITY" || rule.id === "R3-05" || rule.canonical_concept === "invoice_date" || rule.canonical_concept === "document_date";
                const isExactMatch = isDate ? (!rule.date_tolerance_value || rule.date_tolerance_value === 0) : (!rule.tolerance_value || rule.tolerance_value === 0);
                const activeNorms = configToActiveNormalizers(rule.normalizers);
                const isExpanded = expandedRuleV3Ids.has(rule.id);
                const isSelected = selectedRuleV3Ids.has(rule.id);

                return (
                  <div
                    key={rule.id}
                    id={`v2-rule-card-${rule.id}`}
                    className={`v2-rule-item-card ${!rule.is_enabled ? "disabled" : ""} ${isExpanded ? "is-expanded" : ""} ${isSelected ? "is-selected" : ""}`}
                  >
                    {/* Compact Main Row */}
                    <div
                      className="v2-rule-compact-row"
                      onClick={() => toggleRuleExpandV3(rule.id)}
                      title={isExpanded ? "Click to collapse details" : "Click to expand configuration & audit metadata"}
                    >
                      {/* Left: Checkbox for batch selection, Apple switch enable toggle, Order #, Category, Name */}
                      <div className="v2-rule-compact-left">
                        <input
                          type="checkbox"
                          className="v2-card-select-checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRuleV3(rule.id)}
                          onClick={(e) => e.stopPropagation()}
                          title={isSelected ? "Deselect rule" : "Select rule for bulk deletion"}
                        />

                        <label
                          className="v2-apple-switch"
                          onClick={(e) => e.stopPropagation()}
                          title={rule.is_enabled ? "Rule is Active. Click to disable" : "Rule is Disabled. Click to enable"}
                        >
                          <input
                            type="checkbox"
                            checked={rule.is_enabled}
                            onChange={() => handleToggleRuleV3(rule.id)}
                          />
                          <span className="v2-apple-switch-slider" />
                        </label>

                        <span className="v2-rule-order-badge">
                          #{idx + 1}
                        </span>

                        <span className="v2-rule-category-pill">
                          {rule.category.replaceAll("_", " ")}
                        </span>

                        <h3 className="v2-rule-name-text">
                          {rule.name}
                        </h3>
                      </div>

                      {/* Middle: Column Mapping & Parameter Summary */}
                      <div className="v2-rule-compact-mid">
                        <span className="v2-source-pill-compact" title={`Matched intra-table columns: ${rule.source_field_concept} ⟷ ${rule.target_field_concept}`}>
                          <strong className="gov">{rule.source_field_concept}</strong>
                          <span style={{ color: "#94a3b8" }}>⟷</span>
                          <strong className="pr">{rule.target_field_concept}</strong>
                        </span>

                        {rule.origin_session_id && (
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
                            title={`Adopted from session ${rule.origin_session_id}`}
                          >
                            <Sparkles size={11} /> Saved from Session
                          </span>
                        )}

                        {/* Parameter Summary Badge */}
                        {isExactMatch ? (
                          <span className="v2-param-badge" style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }} title="Exact match (0 variance)">
                            Exact Match
                          </span>
                        ) : isDate ? (
                          <span className="v2-param-badge date" title="Date tolerance parameter">
                            ± {rule.date_tolerance_value || 30} {(rule.date_tolerance_unit || "DAYS").toLowerCase()}
                          </span>
                        ) : (
                          <span className="v2-param-badge numeric" title="Numeric tolerance parameter">
                            ± {rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value || 10}`}
                          </span>
                        )}
                        <span className="v2-param-badge" title="Active normalization rules count">
                          {activeNorms.length} normalizer{activeNorms.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      {/* Right: Edit, Delete, Expand Chevron */}
                      <div className="v2-rule-compact-right">
                        <button
                          type="button"
                          className="v2-rule-action-btn edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEditV3(rule);
                          }}
                          title="Edit rule name, columns, tolerances, or rationale"
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          className="v2-rule-action-btn delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            promptDeleteSingleV3(rule);
                          }}
                          title="Delete rule permanently from catalog"
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>

                        <button
                          type="button"
                          className={`v2-expand-chevron-btn ${isExpanded ? "expanded" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRuleExpandV3(rule.id);
                          }}
                          title={isExpanded ? "Collapse ancillary details" : "Expand ancillary details"}
                        >
                          <ChevronDown size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Ancillary Drawer: 2-Column Mac Studio Pro Bento Layout (Exact ss1) */}
                    {isExpanded && (
                      <div className="v2-rule-expanded-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="v2-pro-grid-layout">
                          {/* LEFT COLUMN: Rule Intelligence, Rationale & Audit Lineage */}
                          <div className="v2-pro-intelligence-card">
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <div className="v2-pro-card-header">
                                <ShieldCheck size={14} />
                                <span>Rule Specification & Rationale</span>
                              </div>

                              <p className="v2-pro-desc">
                                {rule.description}
                              </p>

                              <div className="v2-pro-rationale-callout">
                                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                <div>
                                  <strong>Accounting Context:</strong> {rule.statutory_rationale || rule.why_it_matters || "Statutory reconciliation guardrail ensuring strict compliance with GST ITC claims."}
                                </div>
                              </div>

                              {rule.canonical_concept && (
                                <div className="v2-canonical-concept-chip">
                                  Canonical concept: <code>{rule.canonical_concept}</code>
                                </div>
                              )}
                            </div>

                            {/* Bottom Action & Audit Strip */}
                            <div className="v2-pro-lineage-footer">
                              <button
                                type="button"
                                onClick={() => setExplainingRuleV3(rule)}
                                className="v2-explain-pill-btn"
                                title="Click to view deep-dive plain-English explanation, target columns & statutory rationale"
                              >
                                <Sparkles size={13} />
                                <span>Explain Rule with AI</span>
                              </button>

                              <div className="v2-pro-lineage-meta">
                                <div className="v2-audit-item" title="Timestamp when this rule was created">
                                  <Clock size={11} color="#64748b" />
                                  <span>{formatAuditDate(rule.created_at)}</span>
                                </div>

                                <div className="v2-audit-item" title="Author or system agent that authored this rule">
                                  <User size={11} color="#64748b" />
                                  <span>{rule.created_by || "System Standard Baseline"}</span>
                                </div>

                                <span className={`v2-audit-badge ${rule.is_temporary ? "ai" : "system"}`}>
                                  v{rule.version || "1.0.0"}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* RIGHT COLUMN: Interactive Engine Controls (Normalizers + Match Policy) */}
                          <div className="v2-pro-controls-card">
                            {/* SECTION 1: NORMALISERS */}
                            <div className="v2-rule-section-block">
                              <div className="v2-rule-section-header">
                                <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                                  <Sliders size={13} />
                                  <span>Section 1: Normalisation Pipeline</span>
                                </div>
                                <span className="v2-rule-section-count">
                                  {activeNorms.length} active
                                </span>
                              </div>
                              <div className="v2-norm-chips-wrap">
                                {ALL_NORMALIZERS.map((norm) => {
                                  const isActive = activeNorms.includes(norm.type);
                                  return (
                                    <button
                                      key={norm.type}
                                      type="button"
                                      className={`v2-norm-chip ${isActive ? "is-active" : ""}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleNormalizerV3(rule.id, norm.type);
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
                                <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                                  <CheckCircle2 size={13} />
                                  <span>Section 2: Match Policy & Variance</span>
                                </div>
                              </div>

                              <div className="v2-match-mode-selector">
                                <button
                                  type="button"
                                  className={`v2-mode-pill ${isExactMatch ? "is-active" : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSetMatchModeV3(rule.id, "EXACT");
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
                                    handleSetMatchModeV3(rule.id, "TOLERANCE");
                                  }}
                                >
                                  <Sliders size={13} />
                                  <span>Tolerance Match</span>
                                </button>
                              </div>

                              {isExactMatch ? (
                                <div className="v2-exact-mode-info">
                                  <CheckCircle2 size={13} color="#059669" />
                                  <span>Strict 1-to-1 Equality: Permitting 0.00 variance after normalisation.</span>
                                </div>
                              ) : (
                                <div className="v2-tolerance-control-group">
                                  <span className="v2-tolerance-input-label">Permitted Variance:</span>
                                  <div className="v2-tolerance-inputs-row">
                                    <input
                                      type="number"
                                      min={0}
                                      step={!isDate && rule.tolerance_mode === "PERCENTAGE" ? 0.1 : 1}
                                      className="v2-input-number"
                                      value={isDate ? (rule.date_tolerance_value || 30) : (rule.tolerance_value || 10)}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        const val = parseFloat(e.target.value) || 0;
                                        if (isDate) {
                                          handleUpdateDateTolV3(rule.id, Math.round(val));
                                        } else {
                                          handleUpdateNumericTolV3(rule.id, val);
                                        }
                                      }}
                                    />

                                    {isDate ? (
                                      <select
                                        className="v2-select-mode"
                                        value={rule.date_tolerance_unit || "DAYS"}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleUpdateDateTolV3(rule.id, rule.date_tolerance_value || 30, e.target.value as "DAYS" | "MONTHS" | "YEARS");
                                        }}
                                      >
                                        <option value="DAYS">Absolute Days</option>
                                        <option value="MONTHS">Months</option>
                                        <option value="YEARS">Years</option>
                                      </select>
                                    ) : (
                                      <select
                                        className="v2-select-mode"
                                        value={rule.tolerance_mode || "ABSOLUTE_INR"}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleUpdateNumericTolV3(rule.id, rule.tolerance_value || 10, e.target.value as "ABSOLUTE_INR" | "PERCENTAGE");
                                        }}
                                      >
                                        <option value="ABSOLUTE_INR">Absolute Amount (INR)</option>
                                        <option value="PERCENTAGE">Percentage (%)</option>
                                      </select>
                                    )}

                                    <span className="v2-tolerance-formula-hint">
                                      {isDate
                                        ? `(± ${rule.date_tolerance_value || 30} ${(rule.date_tolerance_unit || "DAYS").toLowerCase()})`
                                        : `(|CP - PR| ≤ ${rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value || 10}%` : `₹${rule.tolerance_value || 10}`})`}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155" }}>
                  <input
                    type="checkbox"
                    className="v2-card-select-checkbox"
                    checked={rules.length > 0 && selectedRuleIds.size === rules.length}
                    onChange={handleToggleSelectAll}
                    title="Select all rules for bulk action"
                  />
                  <span>Select All</span>
                </label>
                <span style={{ color: "#94a3b8" }}>|</span>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Master Catalog Rules ({rules.filter((r) => r.is_enabled).length} of {rules.length} active)
                </h2>
              </div>

              <span style={{ fontSize: 12, color: "#64748b" }}>
                Click rule card to view/configure comparison parameters & audit metadata.
              </span>
            </div>

            {rules.map((rule, idx) => {
              const isDate = rule.strategy === "DATE_PROXIMITY" || rule.id === "RW2-003" || rule.id === "RW2-006";
          const isExactMatch = isDate ? rule.date_tolerance_value === 0 : rule.tolerance_value === 0;
          const stat = simulationResult?.rule_breakdowns.find((b) => b.rule_id === rule.id);
          const isExpanded = expandedRuleIds.has(rule.id);
          const isSelected = selectedRuleIds.has(rule.id);

          return (
            <div
              key={rule.id}
              id={`v2-rule-card-${rule.id}`}
              className={`v2-rule-item-card ${!rule.is_enabled ? "disabled" : ""} ${isExpanded ? "is-expanded" : ""} ${isSelected ? "is-selected" : ""} ${rule.is_ai_suggested ? "is-ai-suggested-rule" : ""}`}
            >
              {/* Compact Main Row */}
              <div
                className="v2-rule-compact-row"
                onClick={() => toggleRuleExpand(rule.id)}
                title={isExpanded ? "Click to collapse details" : "Click to expand configuration & audit metadata"}
              >
                {/* Left: Checkbox for batch selection, Apple switch enable toggle, Order #, Category, Name */}
                <div className="v2-rule-compact-left">
                  <input
                    type="checkbox"
                    className="v2-card-select-checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelectRule(rule.id)}
                    onClick={(e) => e.stopPropagation()}
                    title={isSelected ? "Deselect rule" : "Select rule for bulk deletion"}
                  />

                  <label
                    className="v2-apple-switch"
                    onClick={(e) => e.stopPropagation()}
                    title={rule.is_enabled ? "Rule is Active. Click to disable" : "Rule is Disabled. Click to enable"}
                  >
                    <input
                      type="checkbox"
                      checked={rule.is_enabled}
                      onChange={() => handleToggleRule(rule.id)}
                    />
                    <span className="v2-apple-switch-slider" />
                  </label>

                  <span className="v2-rule-order-badge">
                    #{idx + 1}
                  </span>

                  <span className="v2-rule-category-pill">
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

                  {/* AI Suggested or Custom Origin Badges */}
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
                      title="AI suggested or adopted from Stage 3"
                    >
                      <Sparkles size={11} /> AI Suggested
                    </span>
                  )}
                  {rule.is_custom && !rule.is_ai_suggested && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#0369a1",
                        background: "#e0f2fe",
                        border: "1px solid #bae6fd",
                        padding: "2px 7px",
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Custom enterprise rule"
                    >
                      Custom Rule
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

                {/* Right: Simulation Match Stats, Edit, Delete, Expand Chevron */}
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

                  {/* Edit Action Button */}
                  <button
                    type="button"
                    className="v2-rule-action-btn edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit(rule);
                    }}
                    title="Edit rule name, columns, tolerances, or rationale"
                  >
                    <Edit3 size={12} />
                    <span>Edit</span>
                  </button>

                  {/* Single Delete Action Button */}
                  <button
                    type="button"
                    className="v2-rule-action-btn delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      promptDeleteSingle(rule);
                    }}
                    title="Delete rule permanently from catalog"
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>

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

              {/* Expanded Ancillary Drawer: 2-Column Mac Studio Pro Bento Layout */}
              {isExpanded && (
                <div className="v2-rule-expanded-drawer" onClick={(e) => e.stopPropagation()}>
                  <div className="v2-pro-grid-layout">
                    
                    {/* LEFT COLUMN: Rule Intelligence, Rationale & Audit Lineage */}
                    <div className="v2-pro-intelligence-card">
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className="v2-pro-card-header">
                          <ShieldCheck size={14} />
                          <span>Rule Specification & Rationale</span>
                        </div>
                        
                        <p className="v2-pro-desc">
                          {rule.description}
                        </p>

                        <div className="v2-pro-rationale-callout">
                          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          <div>
                            <strong>Accounting Context:</strong> {rule.why_it_matters || "Statutory reconciliation guardrail ensuring strict compliance with GST ITC claims."}
                          </div>
                        </div>

                        {rule.canonical_concept && (
                          <div className="v2-canonical-concept-chip">
                            Canonical concept: <code>{rule.canonical_concept}</code>
                          </div>
                        )}
                      </div>

                      {/* Bottom Action & Audit Strip */}
                      <div className="v2-pro-lineage-footer">
                        <button
                          type="button"
                          onClick={() => setExplainingRule(rule)}
                          className="v2-explain-pill-btn"
                          title="Click to view deep-dive plain-English explanation, target columns & statutory rationale"
                        >
                          <Sparkles size={13} />
                          <span>Explain Rule with AI</span>
                        </button>

                        <div className="v2-pro-lineage-meta">
                          <div className="v2-audit-item" title="Timestamp when this rule was created">
                            <Clock size={11} color="#64748b" />
                            <span>{formatAuditDate(rule.created_at)}</span>
                          </div>

                          <div className="v2-audit-item" title="Author or system agent that authored this rule">
                            <User size={11} color="#64748b" />
                            <span>{rule.created_by || "System Standard Baseline"}</span>
                          </div>

                          <span className={`v2-audit-badge ${rule.is_ai_suggested ? "ai" : rule.is_custom ? "custom" : "system"}`}>
                            v{rule.version || "1.0.0"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT COLUMN: Interactive Engine Controls (Normalizers + Match Policy) */}
                    <div className="v2-pro-controls-card">
                      {/* SECTION 1: NORMALISERS */}
                      <div className="v2-rule-section-block">
                        <div className="v2-rule-section-header">
                          <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                            <Sliders size={13} />
                            <span>Section 1: Normalisation Pipeline</span>
                          </div>
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
                          <div className="v2-pro-card-header" style={{ color: "#334155" }}>
                            <CheckCircle2 size={13} />
                            <span>Section 2: Match Policy & Variance</span>
                          </div>
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
                            <CheckCircle2 size={13} color="#059669" />
                            <span>Strict 1-to-1 Equality: Permitting 0.00 variance after normalisation.</span>
                          </div>
                        ) : (
                          <div className="v2-tolerance-control-group">
                            <span className="v2-tolerance-input-label">Permitted Variance:</span>
                            <div className="v2-tolerance-inputs-row">
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
                                  <option value="ABSOLUTE_INR">Absolute Amount (INR)</option>
                                  <option value="PERCENTAGE">Percentage (%)</option>
                                </select>
                              )}

                              <span className="v2-tolerance-formula-hint">
                                {isDate
                                  ? `(± ${rule.date_tolerance_value} ${rule.date_tolerance_unit.toLowerCase()})`
                                  : `(|GSTR - PR| ≤ ${rule.tolerance_mode === "PERCENTAGE" ? `${rule.tolerance_value}%` : `₹${rule.tolerance_value}`})`}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>
          );
        })}
        </>
      )}
      </section>

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

      {/* --- EDIT RULE MODAL --- */}
      {editingRule && editForm && (
        <div className="v2-delete-modal-overlay" onClick={() => { setEditingRule(null); setEditForm(null); }}>
          <div className="v2-edit-modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Edit3 size={18} color="#2563eb" />
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Edit Reconciliation Rule
                </h2>
              </div>
              <button
                type="button"
                onClick={() => { setEditingRule(null); setEditForm(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="v2-edit-form-grid">
                <div className="v2-edit-form-group">
                  <label>Rule Name</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Category</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>GSTR-2B Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editForm.gstr_column}
                    onChange={(e) => setEditForm({ ...editForm, gstr_column: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Purchase Register Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editForm.pr_column}
                    onChange={(e) => setEditForm({ ...editForm, pr_column: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Plain-English Description</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Accounting & Regulatory Rationale</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editForm.why_it_matters}
                    onChange={(e) => setEditForm({ ...editForm, why_it_matters: e.target.value })}
                  />
                </div>
              </div>

              {/* Normalizers Checklist */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                  Active Normalizers
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ALL_NORMALIZERS.map((norm) => {
                    const checked = editForm.normalizers.includes(norm.type);
                    return (
                      <button
                        key={norm.type}
                        type="button"
                        className={`v2-norm-chip ${checked ? "is-active" : ""}`}
                        onClick={() => {
                          const updated = checked
                            ? editForm.normalizers.filter((n) => n !== norm.type)
                            : [...editForm.normalizers, norm.type];
                          setEditForm({ ...editForm, normalizers: updated });
                        }}
                      >
                        {checked && <CheckCircle2 size={12} />}
                        <span>{norm.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tolerance Parameters */}
              <div style={{ background: "#f8fafc", padding: "14px 16px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                  Comparison Tolerances
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Numeric Tol:</span>
                    <input
                      type="number"
                      min={0}
                      className="v2-input-number"
                      style={{ width: 85 }}
                      value={editForm.tolerance_value}
                      onChange={(e) => setEditForm({ ...editForm, tolerance_value: parseFloat(e.target.value) || 0 })}
                    />
                    <select
                      className="v2-select-mode"
                      value={editForm.tolerance_mode}
                      onChange={(e) => setEditForm({ ...editForm, tolerance_mode: e.target.value as NumericToleranceMode })}
                    >
                      <option value="ABSOLUTE_INR">Absolute INR</option>
                      <option value="PERCENTAGE">Percentage (%)</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Date Tol:</span>
                    <input
                      type="number"
                      min={0}
                      className="v2-input-number"
                      style={{ width: 75 }}
                      value={editForm.date_tolerance_value}
                      onChange={(e) => setEditForm({ ...editForm, date_tolerance_value: parseInt(e.target.value, 10) || 0 })}
                    />
                    <select
                      className="v2-select-mode"
                      value={editForm.date_tolerance_unit}
                      onChange={(e) => setEditForm({ ...editForm, date_tolerance_unit: e.target.value as DateToleranceUnit })}
                    >
                      <option value="DAYS">Days</option>
                      <option value="MONTHS">Months</option>
                      <option value="YEARS">Years</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => { setEditingRule(null); setEditForm(null); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary-v2"
                onClick={handleSaveEdit}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- IRREVERSIBLE CAUTION DELETE CONFIRMATION MODAL --- */}
      {deleteModalState && deleteModalState.isOpen && (
        <div className="v2-delete-modal-overlay" onClick={() => setDeleteModalState(null)}>
          <div className="v2-delete-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-delete-modal-header">
              <div className="v2-delete-icon-wrap">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#991b1b", margin: 0 }}>
                  {deleteModalState.ruleIds.length === 1
                    ? "Permanently Delete Rule?"
                    : `Permanently Delete ${deleteModalState.ruleIds.length} Rules?`}
                </h2>
                <span style={{ fontSize: 12, color: "#7f1d1d" }}>
                  Authoritative Reconciliation Catalog Governance
                </span>
              </div>
            </div>

            <div className="v2-delete-modal-body">
              {/* Mandatory Irreversible Caution Banner */}
              <div className="v2-irreversible-caution-box">
                <AlertTriangle size={24} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div className="v2-caution-text-wrap">
                  <span className="v2-caution-headline">
                    CAUTION: THIS ACTION IS IRREVERSIBLE AND CANNOT BE REVERSED
                  </span>
                  <p className="v2-caution-message">
                    Once deleted, {deleteModalState.ruleIds.length === 1 ? "this rule" : "these rules"} will be permanently removed from the Master Catalog. All associated parameters, normalizers, and execution logic cannot be recovered.
                  </p>
                </div>
              </div>

              {/* Items to be deleted list */}
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                  Rules designated for permanent deletion:
                </span>
                <div className="v2-delete-item-list">
                  {deleteModalState.ruleIds.map((id) => {
                    const item = rules.find((r) => r.id === id);
                    return (
                      <div key={id} className="v2-delete-item-row">
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {item ? item.name : id}
                        </span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          {item?.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p style={{ fontSize: 12.5, color: "#64748b", margin: 0, lineHeight: 1.4 }}>
                Please confirm that you have audited these reconciliation rules and want to proceed with permanent deletion.
              </p>
            </div>

            <div className="v2-delete-modal-footer">
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => setDeleteModalState(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-confirm"
                onClick={handleConfirmDelete}
              >
                <Trash2 size={14} />
                <span>Yes, Permanently Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
            {/* --- V4 PLAIN ENGLISH EXPLANATION MODAL --- */}
      {explainingRuleV4 && (
        <div className="v2-modal-backdrop" onClick={() => setExplainingRuleV4(null)}>
          <div className="v2-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div>
                <span className="v2-rules-eyebrow" style={{ marginBottom: 6 }}>
                  {explainingRuleV4.category.replaceAll("_", " ")}
                </span>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  {explainingRuleV4.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setExplainingRuleV4(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="v2-modal-body">
              <div className="v2-explain-section">
                <span className="v2-explain-label">Plain-English Rule Explanation</span>
                <div className="v2-explain-box">
                  {explainingRuleV4.plain_english_explanation || explainingRuleV4.description}
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Target Concepts</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#f1f5f9", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>SOURCE CONCEPT</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {explainingRuleV4.source_field_concept}
                    </div>
                  </div>
                  <div style={{ background: "#ecfdf5", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#047857", fontWeight: 600 }}>TARGET CONCEPT</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#065f46", marginTop: 4 }}>
                      {explainingRuleV4.target_field_concept}
                    </div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Accounting & Regulatory Rationale</span>
                <div className="v2-explain-box rationale">
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>{explainingRuleV4.statutory_rationale || explainingRuleV4.why_it_matters}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="btn-primary-v2"
                style={{ padding: "8px 18px", fontSize: 13 }}
                onClick={() => setExplainingRuleV4(null)}
              >
                Close Explanation
              </button>
            </div>
          </div>
        </div>
      )}
      {/* --- V3 PLAIN ENGLISH EXPLANATION MODAL --- */}
      {explainingRuleV3 && (
        <div className="v2-modal-backdrop" onClick={() => setExplainingRuleV3(null)}>
          <div className="v2-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div>
                <span className="v2-rules-eyebrow" style={{ marginBottom: 6 }}>
                  {explainingRuleV3.category.replaceAll("_", " ")}
                </span>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  {explainingRuleV3.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setExplainingRuleV3(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="v2-modal-body">
              <div className="v2-explain-section">
                <span className="v2-explain-label">Plain-English Rule Explanation</span>
                <div className="v2-explain-box">
                  {explainingRuleV3.plain_english_explanation || explainingRuleV3.description}
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Columns Evaluated Across Intra-Table Record</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#f1f5f9", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>COUNTERPARTY COLUMN (CP*)</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {explainingRuleV3.source_field_concept}
                    </div>
                  </div>
                  <div style={{ background: "#ecfdf5", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#047857", fontWeight: 600 }}>PURCHASE REGISTER COLUMN (PR*)</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#065f46", marginTop: 4 }}>
                      {explainingRuleV3.target_field_concept}
                    </div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Accounting & Regulatory Rationale (Why It Matters)</span>
                <div className="v2-explain-box rationale">
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>{explainingRuleV3.statutory_rationale || explainingRuleV3.why_it_matters || "Statutory intra-table matching guardrail."}</div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Active Comparison Parameters</span>
                <div style={{ fontSize: 12.5, color: "#475569", background: "#f8fafc", padding: "10px 14px", borderRadius: 8 }}>
                  {explainingRuleV3.match_strategy === "DATE_PROXIMITY" && (
                    <span>
                      Window: ± <strong>{explainingRuleV3.date_tolerance_value || 30} {(explainingRuleV3.date_tolerance_unit || "DAYS").toLowerCase()}</strong>
                    </span>
                  )}
                  {explainingRuleV3.match_strategy === "NUMERIC_TOLERANCE" && (
                    <span>
                      Variance: ± <strong>{explainingRuleV3.tolerance_mode === "PERCENTAGE" ? `${explainingRuleV3.tolerance_value}%` : `₹ ${explainingRuleV3.tolerance_value || 10}`}</strong>
                    </span>
                  )}
                  {explainingRuleV3.match_strategy === "EXACT" && (
                    <span>100% byte-for-byte exact value match</span>
                  )}
                  <div style={{ marginTop: 6, fontSize: 11.5, color: "#64748b" }}>
                    Active Normalizers: <strong>{configToActiveNormalizers(explainingRuleV3.normalizers).join(", ") || "None"}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="btn-primary-v2"
                style={{ padding: "8px 18px", fontSize: 13 }}
                onClick={() => setExplainingRuleV3(null)}
              >
                Close Explanation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- V3 EDIT RULE MODAL --- */}
      {editingRuleV3 && editFormV3 && (
        <div className="v2-delete-modal-overlay" onClick={() => { setEditingRuleV3(null); setEditFormV3(null); }}>
          <div className="v2-edit-modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Edit3 size={18} color="#2563eb" />
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Edit Intra-Table Reconciliation Rule
                </h2>
              </div>
              <button
                type="button"
                onClick={() => { setEditingRuleV3(null); setEditFormV3(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="v2-edit-form-grid">
                <div className="v2-edit-form-group">
                  <label>Rule Name</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV3.name}
                    onChange={(e) => setEditFormV3({ ...editFormV3, name: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Category</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV3.category}
                    onChange={(e) => setEditFormV3({ ...editFormV3, category: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Counterparty (CP*) Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV3.source_field_concept}
                    onChange={(e) => setEditFormV3({ ...editFormV3, source_field_concept: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Purchase Register (PR*) Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV3.target_field_concept}
                    onChange={(e) => setEditFormV3({ ...editFormV3, target_field_concept: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Plain-English Description</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editFormV3.description}
                    onChange={(e) => setEditFormV3({ ...editFormV3, description: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Accounting & Regulatory Rationale</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editFormV3.statutory_rationale}
                    onChange={(e) => setEditFormV3({ ...editFormV3, statutory_rationale: e.target.value })}
                  />
                </div>
              </div>

              {/* Normalizers Checklist */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                  Active Normalizers
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ALL_NORMALIZERS.map((norm) => {
                    const activeList = configToActiveNormalizers(editFormV3.normalizers);
                    const checked = activeList.includes(norm.type);
                    return (
                      <button
                        key={norm.type}
                        type="button"
                        className={`v2-norm-chip ${checked ? "is-active" : ""}`}
                        onClick={() => {
                          const nextNorms = toggleNormalizerInConfig(editFormV3.normalizers, norm.type);
                          setEditFormV3({ ...editFormV3, normalizers: nextNorms });
                        }}
                      >
                        {checked && <CheckCircle2 size={12} />}
                        <span>{norm.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tolerance Parameters */}
              <div style={{ background: "#f8fafc", padding: "14px 16px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                  Comparison Tolerances
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Numeric Tol:</span>
                    <input
                      type="number"
                      min={0}
                      className="v2-input-number"
                      style={{ width: 85 }}
                      value={editFormV3.tolerance_value || 0}
                      onChange={(e) => setEditFormV3({ ...editFormV3, tolerance_value: parseFloat(e.target.value) || 0 })}
                    />
                    <select
                      className="v2-select-mode"
                      value={editFormV3.tolerance_mode || "ABSOLUTE_INR"}
                      onChange={(e) => setEditFormV3({ ...editFormV3, tolerance_mode: e.target.value as "ABSOLUTE_INR" | "PERCENTAGE" })}
                    >
                      <option value="ABSOLUTE_INR">Absolute INR</option>
                      <option value="PERCENTAGE">Percentage (%)</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Date Tol:</span>
                    <input
                      type="number"
                      min={0}
                      className="v2-input-number"
                      style={{ width: 75 }}
                      value={editFormV3.date_tolerance_value || 0}
                      onChange={(e) => setEditFormV3({ ...editFormV3, date_tolerance_value: parseInt(e.target.value, 10) || 0 })}
                    />
                    <select
                      className="v2-select-mode"
                      value={editFormV3.date_tolerance_unit || "DAYS"}
                      onChange={(e) => setEditFormV3({ ...editFormV3, date_tolerance_unit: e.target.value as "DAYS" | "MONTHS" | "YEARS" })}
                    >
                      <option value="DAYS">Days</option>
                      <option value="MONTHS">Months</option>
                      <option value="YEARS">Years</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => { setEditingRuleV3(null); setEditFormV3(null); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary-v2"
                onClick={handleSaveEditV3}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- V3 IRREVERSIBLE CAUTION DELETE CONFIRMATION MODAL --- */}
      {deleteModalStateV3 && deleteModalStateV3.isOpen && (
        <div className="v2-delete-modal-overlay" onClick={() => setDeleteModalStateV3(null)}>
          <div className="v2-delete-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-delete-modal-header">
              <div className="v2-delete-icon-wrap">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#991b1b", margin: 0 }}>
                  {deleteModalStateV3.ruleIds.length === 1
                    ? "Permanently Delete Intra-Table Rule?"
                    : `Permanently Delete ${deleteModalStateV3.ruleIds.length} Intra-Table Rules?`}
                </h2>
                <span style={{ fontSize: 12, color: "#7f1d1d" }}>
                  Authoritative Reconciliation 3.0 Catalog Governance
                </span>
              </div>
            </div>

            <div className="v2-delete-modal-body">
              <div className="v2-irreversible-caution-box">
                <AlertTriangle size={24} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div className="v2-caution-text-wrap">
                  <span className="v2-caution-headline">
                    CAUTION: THIS ACTION IS IRREVERSIBLE AND CANNOT BE REVERSED
                  </span>
                  <p className="v2-caution-message">
                    Once deleted, {deleteModalStateV3.ruleIds.length === 1 ? "this rule" : "these rules"} will be permanently removed from the Master Rules Wiki 3.0 Catalog.
                  </p>
                </div>
              </div>

              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                  Intra-table rules designated for permanent deletion:
                </span>
                <div className="v2-delete-item-list">
                  {deleteModalStateV3.ruleIds.map((id) => {
                    const item = rulesV3.find((r) => r.id === id);
                    return (
                      <div key={id} className="v2-delete-item-row">
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {item ? item.name : id}
                        </span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          {item?.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="v2-delete-modal-footer">
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => setDeleteModalStateV3(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-confirm"
                onClick={handleConfirmDeleteV3}
              >
                <Trash2 size={14} />
                <span>Yes, Permanently Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- V4 EDIT RULE MODAL --- */}
      {editingRuleV4 && editFormV4 && (
        <div className="v2-delete-modal-overlay" onClick={() => { setEditingRuleV4(null); setEditFormV4(null); }}>
          <div className="v2-edit-modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Edit3 size={18} color="#2563eb" />
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Edit Reconciliation Rule
                </h2>
              </div>
              <button
                type="button"
                onClick={() => { setEditingRuleV4(null); setEditFormV4(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="v2-edit-form-grid">
                <div className="v2-edit-form-group">
                  <label>Rule Name</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV4.name}
                    onChange={(e) => setEditFormV4({ ...editFormV4, name: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Category</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV4.category}
                    onChange={(e) => setEditFormV4({ ...editFormV4, category: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Counterparty (CP*) Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV4.source_field_concept}
                    onChange={(e) => setEditFormV4({ ...editFormV4, source_field_concept: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Purchase Register (PR*) Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV4.target_field_concept}
                    onChange={(e) => setEditFormV4({ ...editFormV4, target_field_concept: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Plain-English Description</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editFormV4.description}
                    onChange={(e) => setEditFormV4({ ...editFormV4, description: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Statutory Rationale / Accounting Context</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editFormV4.statutory_rationale}
                    onChange={(e) => setEditFormV4({ ...editFormV4, statutory_rationale: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => { setEditingRuleV4(null); setEditFormV4(null); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary-v2"
                onClick={handleSaveEditV4}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- V4 DELETE CONFIRMATION MODAL --- */}
      {deleteModalStateV4 && deleteModalStateV4.isOpen && (
        <div className="v2-delete-modal-overlay" onClick={() => setDeleteModalStateV4(null)}>
          <div className="v2-delete-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-delete-modal-header">
              <div className="v2-delete-icon-wrap">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#991b1b", margin: 0 }}>
                  Permanently Delete Rule?
                </h2>
                <span style={{ fontSize: 12, color: "#7f1d1d" }}>
                  Authoritative Reconciliation 4.0 Catalog Governance
                </span>
              </div>
            </div>

            <div className="v2-delete-modal-body">
              <div className="v2-irreversible-caution-box">
                <AlertTriangle size={24} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div className="v2-caution-text-wrap">
                  <span className="v2-caution-headline">
                    CAUTION: THIS ACTION IS IRREVERSIBLE AND CANNOT BE REVERSED
                  </span>
                  <p className="v2-caution-message">
                    Once deleted, this rule will be permanently removed from the Master Rules Wiki Catalog.
                  </p>
                </div>
              </div>

              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                  Rule designated for permanent deletion:
                </span>
                <div className="v2-delete-item-list">
                  {deleteModalStateV4.ruleIds.map((id) => {
                    const item = rulesV4.find((r) => r.id === id);
                    return (
                      <div key={id} className="v2-delete-item-row">
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {item ? item.name : id}
                        </span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          {item?.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="v2-delete-modal-footer">
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => setDeleteModalStateV4(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-confirm"
                onClick={handleConfirmDeleteV4}
              >
                <Trash2 size={14} />
                <span>Yes, Permanently Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* --- V5 PLAIN ENGLISH EXPLANATION MODAL --- */}
      {explainingRuleV5 && (
        <div className="v2-modal-backdrop" onClick={() => setExplainingRuleV5(null)}>
          <div className="v2-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-modal-header">
              <div>
                <span className="v2-rules-eyebrow" style={{ marginBottom: 6 }}>
                  {explainingRuleV5.category.replaceAll("_", " ")}
                </span>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  {explainingRuleV5.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setExplainingRuleV5(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="v2-modal-body">
              <div className="v2-explain-section">
                <span className="v2-explain-label">Plain-English Rule Explanation</span>
                <div className="v2-explain-box">
                  {explainingRuleV5.plain_english_explanation || explainingRuleV5.description}
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Two-Table Target Columns</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#f1f5f9", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>GOVERNMENT GSTR-2B</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                      {explainingRuleV5.gstr_column}
                    </div>
                  </div>
                  <div style={{ background: "#ecfdf5", padding: "10px 14px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#047857", fontWeight: 600 }}>PURCHASE REGISTER</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#065f46", marginTop: 4 }}>
                      {explainingRuleV5.pr_column}
                    </div>
                  </div>
                </div>
              </div>

              <div className="v2-explain-section">
                <span className="v2-explain-label">Accounting & Regulatory Rationale</span>
                <div className="v2-explain-box rationale">
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>{explainingRuleV5.statutory_rationale || explainingRuleV5.why_it_matters}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="v2-modal-footer">
              <button
                type="button"
                className="btn-primary-v2"
                style={{ padding: "8px 18px", fontSize: 13 }}
                onClick={() => setExplainingRuleV5(null)}
              >
                Close Explanation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- V5 EDIT RULE MODAL --- */}
      {editingRuleV5 && editFormV5 && (
        <div className="v2-delete-modal-overlay" onClick={() => { setEditingRuleV5(null); setEditFormV5(null); }}>
          <div className="v2-edit-modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Edit3 size={18} color="#2563eb" />
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Edit Double Ledger Rule
                </h2>
              </div>
              <button
                type="button"
                onClick={() => { setEditingRuleV5(null); setEditFormV5(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="v2-edit-form-grid">
                <div className="v2-edit-form-group">
                  <label>Rule Name</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV5.name}
                    onChange={(e) => setEditFormV5({ ...editFormV5, name: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Category</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV5.category}
                    onChange={(e) => setEditFormV5({ ...editFormV5, category: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>GSTR-2B Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV5.gstr_column}
                    onChange={(e) => setEditFormV5({ ...editFormV5, gstr_column: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group">
                  <label>Purchase Register Target Column</label>
                  <input
                    type="text"
                    className="v2-edit-input"
                    value={editFormV5.pr_column}
                    onChange={(e) => setEditFormV5({ ...editFormV5, pr_column: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Plain-English Description</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editFormV5.description}
                    onChange={(e) => setEditFormV5({ ...editFormV5, description: e.target.value })}
                  />
                </div>

                <div className="v2-edit-form-group full">
                  <label>Statutory Rationale / Accounting Context</label>
                  <textarea
                    rows={2}
                    className="v2-edit-input"
                    value={editFormV5.statutory_rationale}
                    onChange={(e) => setEditFormV5({ ...editFormV5, statutory_rationale: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "14px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => { setEditingRuleV5(null); setEditFormV5(null); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary-v2"
                onClick={handleSaveEditV5}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- V5 DELETE CONFIRMATION MODAL --- */}
      {deleteModalStateV5 && deleteModalStateV5.isOpen && (
        <div className="v2-delete-modal-overlay" onClick={() => setDeleteModalStateV5(null)}>
          <div className="v2-delete-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="v2-delete-modal-header">
              <div className="v2-delete-icon-wrap">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#991b1b", margin: 0 }}>
                  Permanently Delete Rule?
                </h2>
                <span style={{ fontSize: 12, color: "#7f1d1d" }}>
                  Authoritative Reconciliation 5.0 Catalog Governance
                </span>
              </div>
            </div>

            <div className="v2-delete-modal-body">
              <div className="v2-irreversible-caution-box">
                <AlertTriangle size={24} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div className="v2-caution-text-wrap">
                  <span className="v2-caution-headline">
                    CAUTION: THIS ACTION IS IRREVERSIBLE AND CANNOT BE REVERSED
                  </span>
                  <p className="v2-caution-message">
                    Once deleted, this rule will be permanently removed from the Master Rules Wiki Catalog.
                  </p>
                </div>
              </div>

              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                  Rule designated for permanent deletion:
                </span>
                <div className="v2-delete-item-list">
                  {deleteModalStateV5.ruleIds.map((id) => {
                    const item = rulesV5.find((r) => r.id === id);
                    return (
                      <div key={id} className="v2-delete-item-row">
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {item ? item.name : id}
                        </span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          {item?.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="v2-delete-modal-footer">
              <button
                type="button"
                className="btn-secondary-v2"
                onClick={() => setDeleteModalStateV5(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-confirm"
                onClick={handleConfirmDeleteV5}
              >
                <Trash2 size={14} />
                <span>Yes, Permanently Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
};
