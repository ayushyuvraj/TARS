import { useEffect, useRef, useState } from "react";
import {
  api,
  CandidateMatch,
  ExceptionBreakdown,
  ExceptionRecord,
  NearMatchSummary,
  SemanticCategory,
  AIInvestigation,
} from "./api";

const numberFormat = new Intl.NumberFormat("en-IN");
const pageSize = 50;
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const categories: SemanticCategory[] = [
  "PRIOR_PERIOD_ADJUSTMENT",
  "ADVANCE_ADJUSTMENT",
  "ITC_REVERSAL",
  "GST_REGISTRATION_CHANGE",
  "RCM_ADJUSTMENT",
  "PRICE_CORRECTION",
  "FREIGHT_ALLOCATION",
  "REGULAR_PURCHASE",
  "OTHER",
  "INSUFFICIENT_EVIDENCE",
];
const decisionFields = new Set([
  "gstin",
  "counterparty_name",
  "document_number",
  "document_date",
  "document_type",
  "taxable_value",
  "gst_rate",
  "igst",
  "cgst",
  "sgst",
  "cess",
]);

export function ExceptionWorkspace({
  reconciliationId,
  onContext,
  onSummary,
}: {
  reconciliationId: string;
  onContext: (recordId: string | null) => void;
  onSummary: (summary: NearMatchSummary) => void;
}) {
  const [breakdown, setBreakdown] = useState<ExceptionBreakdown | null>(null);
  const [records, setRecords] = useState<ExceptionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("MATERIAL_MISMATCH");
  const [selected, setSelected] = useState<ExceptionRecord | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateMatch[]>([]);
  const [semantic, setSemantic] = useState<{
    available: boolean;
    provider: string | null;
    model: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState<SemanticCategory>("OTHER");
  const [investigationStatus, setInvestigationStatus] = useState<{
    available: boolean; model: string; reason: string | null;
  } | null>(null);
  const [investigation, setInvestigation] = useState<AIInvestigation | null>(null);
  const [investigationBusy, setInvestigationBusy] = useState(false);
  const [investigationError, setInvestigationError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const investigationRequest = useRef<AbortController | null>(null);

  const errorMessage = (reason: unknown) => reason instanceof DOMException && reason.name === "AbortError"
    ? "The request timed out or was replaced by a newer request."
    : reason instanceof Error ? reason.message : "The server returned an unexpected error.";

  const loadSummary = async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    setSummaryError(null);
    try {
      setBreakdown(await api.exceptionBreakdown(reconciliationId, controller.signal));
    } catch (reason) {
      setSummaryError(errorMessage(reason));
    } finally {
      window.clearTimeout(timer);
    }
  };

  const loadPage = async (nextStatus = status, nextOffset = offset) => {
    pageRequest.current?.abort();
    const controller = new AbortController();
    pageRequest.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    setListLoading(true);
    setListError(null);
    setRecords([]);
    try {
      const page = await api.exceptionRecords(
        reconciliationId, nextStatus, nextOffset, pageSize, controller.signal,
      );
      if (pageRequest.current !== controller) return;
      setRecords(page.records);
      setTotal(page.total);
      setOffset(page.offset);
    } catch (reason) {
      if (pageRequest.current === controller) setListError(errorMessage(reason));
    } finally {
      window.clearTimeout(timer);
      if (pageRequest.current === controller) setListLoading(false);
    }
  };

  const loadAvailability = async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const [availability, aiAvailability] = await Promise.all([
        api.semanticStatus(reconciliationId, controller.signal),
        api.investigationStatus(reconciliationId, controller.signal),
      ]);
      setSemantic(availability);
      setInvestigationStatus(aiAvailability);
    } catch {
      setSemantic({ available: false, provider: null, model: null });
      setInvestigationStatus({ available: false, model: "", reason: "Provider status could not be loaded." });
    } finally {
      window.clearTimeout(timer);
    }
  };

  useEffect(() => {
    void loadSummary();
    void loadPage("MATERIAL_MISMATCH", 0);
    void loadAvailability();
    return () => {
      pageRequest.current?.abort();
      detailRequest.current?.abort();
      investigationRequest.current?.abort();
    };
  }, [reconciliationId]);

  const filter = (next: string) => {
    setStatus(next);
    setSelected(null);
    setSelectedId(null);
    setInvestigation(null);
    setInvestigationError(null);
    setCandidates([]);
    onContext(null);
    void loadPage(next, 0);
  };
  const choose = async (record: ExceptionRecord) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    setSelectedId(record.record_id);
    setSelected(null);
    setDetailLoading(true);
    setDetailError(null);
    setCandidates([]);
    setInvestigation(null);
    setInvestigationError(null);
    onContext(record.record_id);
    try {
      const [detail, history, ranked] = await Promise.all([
        api.exceptionRecord(reconciliationId, record.record_id, controller.signal),
        api.investigations(reconciliationId, record.record_id, controller.signal),
        record.status === "AMBIGUOUS"
          ? api.rankedCandidates(reconciliationId, record.record_id, controller.signal)
          : Promise.resolve([]),
      ]);
      if (detailRequest.current !== controller) return;
      setSelected(detail);
      setCategory(
        detail.semantic_classification?.final_category ??
          detail.semantic_classification?.proposed_category ?? "OTHER",
      );
      setInvestigation(history.find((item) => item.status === "completed") ?? history[0] ?? null);
      setCandidates(ranked.length ? ranked : detail.best_candidate ? [detail.best_candidate] : []);
    } catch (reason) {
      if (detailRequest.current === controller) setDetailError(errorMessage(reason));
    } finally {
      window.clearTimeout(timer);
      if (detailRequest.current === controller) setDetailLoading(false);
    }
  };
  const investigate = async () => {
    if (!selected) return;
    investigationRequest.current?.abort();
    const controller = new AbortController();
    investigationRequest.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 120_000);
    setInvestigationBusy(true);
    setInvestigationError(null);
    setNotice("Gathering authoritative exception evidence…");
    try {
      const result = await api.investigateException(
        reconciliationId, selected.record_id, controller.signal,
      );
      if (investigationRequest.current !== controller) return;
      setInvestigation(result);
      setNotice("AI investigation completed and passed factual consistency validation. Human review is still required.");
    } catch (reason) {
      if (investigationRequest.current !== controller) return;
      const message = (
        reason instanceof DOMException && reason.name === "AbortError"
          ? "AI investigation exceeded 2 minutes. Do not retry immediately; reselect this record shortly to check for a saved result, or continue with deterministic evidence."
          : reason instanceof Error
            ? `${reason.message} Retry, or continue with the deterministic evidence above.`
            : "AI investigation failed safely. Retry, or use deterministic evidence."
      );
      setInvestigationError(message);
      setNotice(null);
    } finally {
      window.clearTimeout(timer);
      if (investigationRequest.current === controller) {
        investigationRequest.current = null;
        setInvestigationBusy(false);
      }
    }
  };
  const analyzePage = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.analyzeSemantics(
        reconciliationId,
        records.map((item) => item.record_id),
      );
      setNotice(
        `${result.completed} classifications created${result.failed ? ` · ${result.failed} failed and were preserved for retry` : ""}. No reconciliation decisions were made.`,
      );
      await Promise.all([loadSummary(), loadPage(status, offset)]);
      if (selected) await choose(selected);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Semantic analysis failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const semanticDecision = async (
    action: "confirm" | "override" | "leave_unclassified",
  ) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.semanticDecision(
        reconciliationId,
        selected.record_id,
        action,
        action === "override" ? category : undefined,
      );
      setNotice(
        "Semantic review saved. This classification does not reconcile the transaction.",
      );
      await Promise.all([loadSummary(), loadPage(status, offset)]);
      await choose(selected);
    } finally {
      setBusy(false);
    }
  };
  const ambiguousDecision = async (
    action: "select" | "leave_unresolved",
    purchaseId?: string,
  ) => {
    if (!selected) return;
    setBusy(true);
    try {
      const summary = await api.selectAmbiguous(
        reconciliationId,
        selected.record_id,
        action,
        purchaseId,
      );
      onSummary(summary);
      setNotice(
        action === "select"
          ? `Human selection persisted as HUMAN_SELECTED. ${summary.resolved_records} records are now resolved.`
          : "Decision persisted: left unresolved.",
      );
      setSelected(null);
      setSelectedId(null);
      onContext(null);
      await Promise.all([loadSummary(), loadPage("AMBIGUOUS", 0)]);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Selection failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!breakdown && summaryError)
    return (
      <section className="results exception-workspace exception-load-error" role="alert">
        <h2>Could not load exceptions</h2>
        <p>{summaryError}</p>
        <button onClick={() => void loadSummary()}>Retry</button>
      </section>
    );
  if (!breakdown)
    return (
      <section className="results exception-workspace">
        <p role="status">Loading exception intelligence…</p>
      </section>
    );
  const filters = [
    ["MATERIAL_MISMATCH", "Material mismatch", breakdown.material_mismatch],
    ["AMBIGUOUS", "Ambiguous", breakdown.ambiguous],
    ["GST_ONLY", "GST only", breakdown.gst_only],
    ["PR_ONLY", "PR only", breakdown.pr_only],
  ] as const;
  const decisionEntries = selected
    ? Object.entries(selected.values).filter(([key]) => decisionFields.has(key))
    : [];
  const additionalEntries = selected
    ? Object.entries(selected.values).filter(([key]) => !decisionFields.has(key))
    : [];
  return (
    <section
      className="results exception-workspace"
      aria-labelledby="exceptions-title"
    >
      <div className="section-heading">
        <div>
          <span className="step">06</span>
          <div>
            <h2 id="exceptions-title">Exception Intelligence</h2>
            <p>
              Deterministic facts first · semantic classifications remain
              human-reviewed suggestions
            </p>
          </div>
        </div>
        {semantic?.available ? (
          <button disabled={busy || records.length === 0} onClick={analyzePage}>
            {busy ? "Analyzing…" : `Analyze visible ${records.length} with AI`}
          </button>
        ) : (
          <span className="provider-unavailable">
            Semantic analysis requires an AI provider · deterministic evidence remains available
          </span>
        )}
      </div>
      <div className="exception-metrics">
        <article>
          <span>Remaining Government</span>
          <strong>{numberFormat.format(breakdown.remaining_government)}</strong>
        </article>
        <article>
          <span>Remaining PR</span>
          <strong>
            {numberFormat.format(breakdown.remaining_purchase_register)}
          </strong>
        </article>
        {filters.map((item) => (
          <article key={item[0]}>
            <span>{item[1]}</span>
            <strong>{numberFormat.format(item[2])}</strong>
          </article>
        ))}
      </div>
      {Object.keys(breakdown.semantic_categories).length > 0 && (
        <div className="semantic-summary">
          <strong>Persisted semantic categories</strong>
          {Object.entries(breakdown.semantic_categories).map(
            ([name, count]) => (
              <span key={name}>
                {name.replaceAll("_", " ")} <b>{count}</b>
              </span>
            ),
          )}
        </div>
      )}
      <div
        className="result-tabs"
        role="group"
        aria-label="Filter exception records"
      >
        {filters.map((item) => (
          <button
            key={item[0]}
            className={status === item[0] ? "active" : ""}
            aria-pressed={status === item[0]}
            onClick={() => filter(item[0])}
          >
            {item[1]} <span>{item[2]}</span>
          </button>
        ))}
      </div>
      {notice && (
        <div className="exception-notice" role="status" aria-atomic="true">
          {notice}
        </div>
      )}
      <div className="exception-layout">
        <div
          className="exception-list"
          aria-busy={listLoading}
          aria-label={`${status.replaceAll("_", " ")} records`}
        >
          <p>
            {numberFormat.format(total)} records · {records.length
              ? `showing ${numberFormat.format(offset + 1)}–${numberFormat.format(offset + records.length)}`
              : "no rows on this page"}
          </p>
          {listLoading && <div className="exception-list-state" role="status">Loading page…</div>}
          {!listLoading && listError && <div className="exception-list-state exception-list-state--error" role="alert"><strong>Could not load exceptions</strong><span>{listError}</span><button className="button-secondary button-compact" onClick={() => void loadPage(status, offset)}>Retry</button></div>}
          {!listLoading && !listError && records.length === 0 && <div className="exception-list-state">No exception rows in this category.</div>}
          {records.map((record) => (
            <button
              key={record.record_id}
              className={
                selectedId === record.record_id ? "active" : ""
              }
              onClick={() => void choose(record)}
              disabled={detailLoading && selectedId === record.record_id}
            >
              <span>
                <strong>{record.record_id}</strong>
                <small>
                  {String(
                    record.values.counterparty_name ??
                      record.values.gstin ??
                      "No vendor label",
                  )}
                </small>
              </span>
              <span>
                <b>{money.format(Number(record.values.taxable_value ?? 0))}</b>
                <small>
                  {record.semantic_classification
                    ? (
                        record.semantic_classification.final_category ??
                        record.semantic_classification.proposed_category
                      ).replaceAll("_", " ")
                    : "Not semantically analyzed"}
                </small>
              </span>
            </button>
          ))}
          {!listLoading && !listError && total > pageSize && <div className="exception-pagination" aria-label="Exception pagination"><button className="button-secondary button-compact" disabled={offset === 0} onClick={() => void loadPage(status, Math.max(0, offset - pageSize))}>Previous</button><span>Page {Math.floor(offset / pageSize) + 1} of {Math.ceil(total / pageSize)}</span><button className="button-secondary button-compact" disabled={offset + pageSize >= total} onClick={() => void loadPage(status, offset + pageSize)}>Next</button></div>}
        </div>
        <div className="exception-detail">
          {detailLoading ? (
            <div className="empty-policy" role="status"><strong>Loading record evidence…</strong><p>Only the selected exception is being retrieved.</p></div>
          ) : detailError ? (
            <div className="empty-policy exception-detail-error" role="alert"><strong>Could not load record evidence</strong><p>{detailError}</p><button className="button-secondary" onClick={() => { const row = records.find(item => item.record_id === selectedId); if (row) void choose(row); }}>Retry</button></div>
          ) : !selected ? (
            <div className="empty-policy">
              <strong>Select an exception</strong>
              <p>
                Inspect source values, candidates, variances, semantic
                suggestions, and human actions.
              </p>
            </div>
          ) : (
            <>
              <div className="exception-detail__heading">
                <div>
                  <span
                    className={`result-status result-status--${selected.status.toLowerCase()}`}
                  >
                    {selected.status.replaceAll("_", " ")}
                  </span>
                  <h3>{selected.record_id}</h3>
                </div>
                <button
                  className="button-secondary button-compact"
                  onClick={() => {
                    setSelected(null);
                    setSelectedId(null);
                    onContext(null);
                  }}
                >
                  Close
                </button>
              </div>
              <div className="record-facts">
                {decisionEntries.map(([key, value]) => (
                  <p key={key}>
                    <small>{key.replaceAll("_", " ")}</small>
                    <strong>{String(value ?? "—")}</strong>
                  </p>
                ))}
              </div>
              {additionalEntries.length > 0 && (
                <details className="record-more">
                  <summary>View all source fields ({additionalEntries.length} more)</summary>
                  <div className="record-facts">
                    {additionalEntries.map(([key, value]) => (
                      <p key={key}>
                        <small>{key.replaceAll("_", " ")}</small>
                        <strong>{String(value ?? "—")}</strong>
                      </p>
                    ))}
                  </div>
                </details>
              )}
              {candidates.length > 0 && (
                <div className="exception-candidates">
                  <h4>
                    {selected.status === "AMBIGUOUS"
                      ? "Ranked candidates · automatic selection disabled"
                      : "Probable counterpart"}
                  </h4>
                  {candidates.slice(0, 2).map((candidate) => (
                    <article key={candidate.id}>
                      <div>
                        <strong>{candidate.purchase_register_record_id}</strong>
                        <span>
                          Candidate score{" "}
                          {(candidate.match_score * 100).toFixed(1)}%
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>Invoice</dt>
                          <dd>
                            {candidate.features.document_number_purchase_raw}
                          </dd>
                        </div>
                        <div>
                          <dt>Taxable variance</dt>
                          <dd>
                            {money.format(
                              candidate.features.taxable_value_difference,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Date variance</dt>
                          <dd>
                            {candidate.features.document_date_difference_days}{" "}
                            days
                          </dd>
                        </div>
                      </dl>
                      {selected.status === "AMBIGUOUS" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void ambiguousDecision(
                              "select",
                              candidate.purchase_register_record_id,
                            )
                          }
                        >
                          Select {candidate.purchase_register_record_id}
                        </button>
                      )}
                    </article>
                  ))}
                  {selected.status === "AMBIGUOUS" && (
                    <button
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => void ambiguousDecision("leave_unresolved")}
                    >
                      Leave unresolved
                    </button>
                  )}
                </div>
              )}
              <section className="ai-investigation" aria-labelledby="ai-investigation-title" aria-busy={investigationBusy}>
                <div className="ai-investigation__heading">
                  <div>
                    <h4 id="ai-investigation-title">AI exception investigation</h4>
                    <p>Read-only analysis grounded in TARS evidence · human authority preserved</p>
                  </div>
                  <button
                    disabled={investigationBusy || !investigationStatus?.available}
                    onClick={() => void investigate()}
                  >
                    {investigationBusy ? "Gathering evidence…" : "Investigate with AI"}
                  </button>
                </div>
                {investigationBusy && (
                  <p className="provider-unavailable" role="status">Analyzing this record only. No other exceptions are sent to the model.</p>
                )}
                {investigationError && (
                  <p className="ai-investigation__error" role="alert">{investigationError}</p>
                )}
                {!investigationStatus?.available && (
                  <p className="provider-unavailable">{investigationStatus?.reason ?? "AI provider status unavailable."} Deterministic evidence remains available.</p>
                )}
                {investigation?.status === "failed" && (
                  <p className="ai-investigation__error">{investigation.error_message}</p>
                )}
                {investigation?.status === "completed" && investigation.conclusion && (
                  <div className="investigation-result">
                    <div><span>Likely Cause</span><p>{investigation.conclusion.likely_root_cause}</p></div>
                    <div><span>Reasoning Summary</span><ol>{investigation.conclusion.reasoning_summary.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol></div>
                    <div><span>Evidence</span><ul>{investigation.conclusion.evidence.map(item => <li key={item.reference_id}><strong>{item.reference_id}</strong> · {item.tool_name.replaceAll("_", " ")}{item.fact_paths.length ? ` · ${item.fact_paths.join(", ")}` : ""}</li>)}</ul></div>
                    <div><span>Recommended Action</span><p>{investigation.conclusion.recommended_action}</p></div>
                    <div className="investigation-confidence"><span>Confidence</span><strong>{Math.round(investigation.conclusion.confidence * 100)}%</strong><small>Model estimate · validated evidence links</small></div>
                    <div><span>Limitations</span>{investigation.conclusion.limitations.length || investigation.conclusion.data_needed.length ? <ul>{[...investigation.conclusion.limitations, ...investigation.conclusion.data_needed.map(item => `Data needed: ${item}`)].map(item => <li key={item}>{item}</li>)}</ul> : <p>No additional limitations reported.</p>}</div>
                    <details className="execution-trace">
                      <summary>View Execution Trace</summary>
                      <p>{investigation.provider} · {investigation.model} · {investigation.latency_ms.toFixed(0)} ms · validation {investigation.validation_result.valid ? "passed" : "failed"}</p>
                      {investigation.execution_trace.map(step => <article key={step.sequence}><strong>{step.sequence}. {step.name.replaceAll("_", " ")}</strong><span>{step.stage} · {step.duration_ms.toFixed(0)} ms</span><pre>{JSON.stringify(step.structured_result, null, 2)}</pre></article>)}
                    </details>
                  </div>
                )}
              </section>
              {selected.semantic_classification && (
                <div className="semantic-review">
                  <h4>AI semantic suggestion</h4>
                  <strong>
                    {(
                      selected.semantic_classification.final_category ??
                      selected.semantic_classification.proposed_category
                    ).replaceAll("_", " ")}
                  </strong>
                  <p>{selected.semantic_classification.reason}</p>
                  <small>
                    {Math.round(
                      selected.semantic_classification.confidence * 100,
                    )}
                    % AI confidence · human review required
                  </small>
                  <div>
                    <button
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => void semanticDecision("confirm")}
                    >
                      Confirm category
                    </button>
                    <label htmlFor="semantic-category">Change category</label>
                    <select
                      id="semantic-category"
                      value={category}
                      onChange={(event) =>
                        setCategory(event.target.value as SemanticCategory)
                      }
                    >
                      {categories.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                    <button
                      disabled={busy}
                      onClick={() => void semanticDecision("override")}
                    >
                      Save override
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
