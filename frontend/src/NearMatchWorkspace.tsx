import { useMemo, useState } from "react";
import { CandidateMatch, NearMatchAnalysis, NearMatchBulkApprovalResult, NearMatchSummary } from "./api";

const numberFormat = new Intl.NumberFormat("en-IN");
const moneyFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

type ReviewFilter = "PROPOSED" | "AMBIGUOUS" | "MATERIAL_MISMATCH" | "GST_ONLY" | "PR_ONLY";

function RecordColumn({ title, values }: { title: string; values: Record<string, unknown> }) {
  return <div className="candidate-record"><span>{title}</span>{Object.entries(values).map(([key, value]) =>
    <p key={key}><small>{key.replaceAll("_", " ")}</small><strong>{String(value ?? "—")}</strong></p>
  )}</div>;
}

function Evidence({ candidate }: { candidate: CandidateMatch }) {
  const features = candidate.features;
  return <dl className="candidate-evidence">
    <div><dt>Score</dt><dd>{(candidate.match_score * 100).toFixed(1)}%</dd></div>
    <div><dt>Invoice similarity</dt><dd>{(features.document_number_similarity * 100).toFixed(1)}%</dd></div>
    <div><dt>Normalized invoices</dt><dd><code>{features.document_number_government_normalized}</code><span aria-hidden="true"> / </span><code>{features.document_number_purchase_normalized}</code></dd></div>
    <div><dt>Date variance</dt><dd>{features.document_date_difference_days} days</dd></div>
    <div><dt>Taxable variance</dt><dd>{moneyFormat.format(features.taxable_value_difference)}</dd></div>
  </dl>;
}

export function NearMatchWorkspace({ analysis, summary, busy, onAnalyze, onDecision, onBulkApprove }: {
  analysis: NearMatchAnalysis | null;
  summary: NearMatchSummary | null;
  busy: boolean;
  onAnalyze: () => Promise<void>;
  onDecision: (candidateId: string, action: "approve" | "reject") => Promise<void>;
  onBulkApprove: () => Promise<NearMatchBulkApprovalResult>;
}) {
  const [filter, setFilter] = useState<ReviewFilter>("PROPOSED");
  const [page, setPage] = useState(0);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<NearMatchBulkApprovalResult | null>(null);
  const [reviewSkipped, setReviewSkipped] = useState(false);
  const candidatesById = useMemo(() => new Map(analysis?.candidates.map(item => [item.id, item]) ?? []), [analysis]);
  const proposed = analysis?.candidates.filter(item => item.status === "NEAR_MATCH_PROPOSED") ?? [];
  const skippedByCandidate = useMemo(() => new Map(
    bulkResult?.skip_reasons.map(item => [item.candidate_id, item]) ?? []
  ), [bulkResult]);
  const displayedProposed = reviewSkipped
    ? proposed.filter(item => skippedByCandidate.has(item.id))
    : proposed;
  const ambiguityRows = analysis?.ambiguities ?? [];
  const identifiers = filter === "MATERIAL_MISMATCH" ? analysis?.material_mismatch_government_ids ?? []
    : filter === "GST_ONLY" ? analysis?.gst_only_government_ids ?? []
    : filter === "PR_ONLY" ? analysis?.pr_only_purchase_register_ids ?? [] : [];
  const pageSize = 20;
  const count = filter === "PROPOSED" ? displayedProposed.length : filter === "AMBIGUOUS" ? ambiguityRows.length : identifiers.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const selectFilter = (next: ReviewFilter) => { setFilter(next); setPage(0); };
  const runBulkApproval = async () => {
    try {
      const result = await onBulkApprove();
      setBulkResult(result);
      setConfirmingBulk(false);
      setReviewSkipped(false);
      setPage(0);
    } catch {
      setConfirmingBulk(false);
    }
  };

  if (!analysis) return <section className="results near-intro" aria-labelledby="near-title"><div className="section-heading"><div><span className="step">05</span><div><h2 id="near-title">Near-match candidate review</h2><p>Generate blocked, ranked candidates without consuming a record.</p></div></div></div><div className="near-callout"><div><strong>Human approval is mandatory</strong><p>Normalization and fuzzy similarity create evidence only. No proposed pair becomes a match until you approve it.</p></div><button onClick={onAnalyze} disabled={busy}>{busy ? "Analyzing…" : "Analyze remaining records"}</button></div></section>;

  const tabs: { key: ReviewFilter; label: string; count: number }[] = [
    { key: "PROPOSED", label: "Safe proposals", count: proposed.length },
    { key: "AMBIGUOUS", label: "Ambiguous", count: ambiguityRows.length },
    { key: "MATERIAL_MISMATCH", label: "Material mismatch", count: analysis.material_mismatch_government_ids.length },
    { key: "GST_ONLY", label: "GST only", count: analysis.gst_only_government_ids.length },
    { key: "PR_ONLY", label: "PR only", count: analysis.pr_only_purchase_register_ids.length },
  ];
  return <section className="results near-workspace" aria-labelledby="near-title"><div className="section-heading"><div><span className="step">05</span><div><h2 id="near-title">Near-match candidate review</h2><p>{numberFormat.format(analysis.summary.candidate_count)} candidates ranked in {analysis.summary.runtime_ms.toFixed(0)} ms · no automatic consumption</p></div></div>{summary?.status === "completed" ? <span className="complete-badge">Review complete</span> : null}</div>
    <div className="near-metrics"><article><span>Safe proposals</span><strong>{numberFormat.format(proposed.length)}</strong></article><article><span>Ambiguous</span><strong>{numberFormat.format(analysis.summary.ambiguous_government_records)}</strong></article><article><span>Material mismatch</span><strong>{numberFormat.format(analysis.summary.material_mismatch_records)}</strong></article><article><span>Resolved total</span><strong>{numberFormat.format(summary?.resolved_records ?? 660)}</strong></article></div>
    <div className="result-tabs near-tabs" role="group" aria-label="Filter near-match review">{tabs.map(tab => <button key={tab.key} className={filter === tab.key ? "active" : ""} aria-pressed={filter === tab.key} onClick={() => selectFilter(tab.key)}>{tab.label}<span>{numberFormat.format(tab.count)}</span></button>)}</div>
    {filter === "PROPOSED" && proposed.length > 0 && <section className="near-bulk-action" aria-labelledby="near-bulk-title">
      {!confirmingBulk ? <>
        <div><span>Safe proposals</span><h3 id="near-bulk-title">{numberFormat.format(proposed.length)} safe near-match proposals</h3><p>These proposals currently satisfy the approved near-match criteria and uniqueness safeguards.</p></div>
        <div className="near-bulk-buttons"><button onClick={() => setConfirmingBulk(true)} disabled={busy}>Approve all {numberFormat.format(proposed.length)} eligible proposals</button><span>Or review individually below</span></div>
      </> : <>
        <div><span>Human confirmation required</span><h3 id="near-bulk-title">Approve {numberFormat.format(proposed.length)} safe near matches?</h3><p>TARS will revalidate every proposal against the current policy, candidate uniqueness, score-gap, and duplicate-consumption safeguards. Ambiguous and other exception categories will not be affected.</p></div>
        <div className="near-bulk-buttons"><button className="button-secondary" onClick={() => setConfirmingBulk(false)} disabled={busy}>Cancel</button><button onClick={runBulkApproval} disabled={busy}>{busy ? "Revalidating and approving…" : `Approve ${numberFormat.format(proposed.length)}`}</button></div>
      </>}
    </section>}
    {filter === "PROPOSED" && bulkResult && <section className={`near-bulk-result ${bulkResult.skipped ? "near-bulk-result--warning" : ""}`} aria-live="polite">
      <div><span>{bulkResult.skipped ? "Bulk approval completed" : "Safe proposals approved"}</span><h3>{numberFormat.format(bulkResult.approved)} near matches approved</h3><p>{numberFormat.format(bulkResult.skipped)} skipped · {numberFormat.format(bulkResult.duplicate_pr_consumption)} duplicate PR consumption</p></div>
      <dl><div><dt>Resolved Government records</dt><dd>{numberFormat.format(bulkResult.before.resolved_records)} <span aria-hidden="true">→</span> {numberFormat.format(bulkResult.after.resolved_records)}</dd></div><div><dt>Remaining Government</dt><dd>{numberFormat.format(bulkResult.before.government_open)} <span aria-hidden="true">→</span> {numberFormat.format(bulkResult.after.government_open)}</dd></div><div><dt>PR remaining</dt><dd>{numberFormat.format(bulkResult.before.purchase_register_remaining)} <span aria-hidden="true">→</span> {numberFormat.format(bulkResult.after.purchase_register_remaining)}</dd></div></dl>
      {bulkResult.skipped > 0 && <button className="button-secondary" aria-expanded={reviewSkipped} onClick={() => { setReviewSkipped(value => !value); setPage(0); }}>{reviewSkipped ? "Show all safe proposals" : `Review ${numberFormat.format(bulkResult.skipped)} skipped proposals`}</button>}
    </section>}
    <div aria-live="polite" className="candidate-list">
      {filter === "PROPOSED" && displayedProposed.slice(page * pageSize, page * pageSize + pageSize).map(candidate => { const skipped = skippedByCandidate.get(candidate.id); return <article className="candidate-card" key={candidate.id}>{skipped && <div className="candidate-skip-reason" role="status"><strong>Not approved: {skipped.code.replaceAll("_", " ")}</strong><span>{skipped.message}</span></div>}<div className="candidate-card__heading"><div><span className="result-status result-status--near_match_proposed">Safe proposal</span><h3>{candidate.government_record_id} <span aria-hidden="true">↔</span> {candidate.purchase_register_record_id}</h3></div><strong className="score">{(candidate.match_score * 100).toFixed(1)}%</strong></div><div className="record-pair"><RecordColumn title="Government record" values={candidate.government_values} /><RecordColumn title="Purchase Register record" values={candidate.purchase_register_values} /></div><Evidence candidate={candidate} /><div className="candidate-actions"><p>Reciprocal best · material values within safety limits</p><button className="button-secondary" disabled={busy} onClick={() => onDecision(candidate.id, "reject")}>Reject</button><button disabled={busy} onClick={() => onDecision(candidate.id, "approve")}>Approve pair</button></div></article>; })}
      {filter === "AMBIGUOUS" && ambiguityRows.slice(page * pageSize, page * pageSize + pageSize).map(group => { const choices = group.candidate_ids.map(id => candidatesById.get(id)).filter(Boolean).slice(0, 2) as CandidateMatch[]; return <article className="ambiguity-card" key={group.government_record_id}><div className="candidate-card__heading"><div><span className="result-status result-status--ambiguous">Manual review only</span><h3>{group.government_record_id}</h3><p>{group.candidate_count} plausible candidates · top-two gap {(group.score_gap * 100).toFixed(1)} points</p></div></div><div className="ambiguity-compare">{choices.map(choice => <div key={choice.id}><RecordColumn title={`Candidate ${choice.rank} · ${choice.purchase_register_record_id}`} values={choice.purchase_register_values} /><Evidence candidate={choice} /></div>)}</div><p className="ambiguity-note">Approval is disabled because the candidates are too close. Resolve outside this safe-approval queue.</p></article>; })}
      {!(["PROPOSED", "AMBIGUOUS"] as ReviewFilter[]).includes(filter) && <div className="identifier-grid">{identifiers.slice(page * pageSize, page * pageSize + pageSize).map(id => <span key={id}>{id}</span>)}</div>}
      {count === 0 && <div className="empty-policy"><strong>No records in this queue</strong><p>The current review state has no items for this filter.</p></div>}
    </div>
    <div className="table-pagination"><p>Page {page + 1} of {pages} · {numberFormat.format(count)} records</p><div><button className="button-secondary button-compact" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><button className="button-secondary button-compact" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div></div>
  </section>;
}
