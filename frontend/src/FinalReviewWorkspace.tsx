import { useEffect, useRef, useState } from "react";
import { api, ExportRecord, FinalReview } from "./api";

const format = new Intl.NumberFormat("en-IN");

export function FinalReviewWorkspace({
  reconciliationId,
  onAuditChanged,
}: {
  reconciliationId: string;
  onAuditChanged: () => void;
}) {
  const [review, setReview] = useState<FinalReview | null>(null);
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const load = async () => {
    const [nextReview, nextHistory] = await Promise.all([
      api.finalReview(reconciliationId),
      api.exports(reconciliationId),
    ]);
    setReview(nextReview);
    setHistory(nextHistory);
  };
  useEffect(() => {
    void load().catch((reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Final review could not be loaded.",
      ),
    );
  }, [reconciliationId]);
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.generateExport(reconciliationId);
      await load();
      onAuditChanged();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The final export could not be generated.",
      );
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };
  if (!review)
    return (
      <section className="results final-review" aria-busy="true">
        <p>Loading final review…</p>
      </section>
    );
  const metrics = [
    ["Exact matches", review.exact_matches],
    ["Tolerance matches", review.tolerance_matches],
    ["Near matches", review.near_matches],
    ["Human selected", review.human_selected_matches],
    ["Resolved Government", review.resolved_records],
    ["Unresolved outcome rows", review.unresolved_records],
  ] as const;
  return (
    <section
      className="results final-review"
      aria-labelledby="final-review-title"
    >
      <div className="section-heading">
        <div>
          <span className="step">08</span>
          <div>
            <h2 id="final-review-title">Final Review & Export</h2>
            <p>Explicit generation · KIGS reconciliation export POC</p>
          </div>
        </div>
        <span
          className={
            review.validation.valid
              ? "complete-badge"
              : "result-status result-status--material_mismatch"
          }
        >
          {review.validation.valid ? "Ready" : "Blocked"}
        </span>
      </div>
      <div className="final-review__metrics">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{format.format(value)}</strong>
          </div>
        ))}
      </div>
      <div className="final-review__context">
        <dl>
          <div>
            <dt>Export profile</dt>
            <dd>
              {review.export_profile.name} v{review.export_profile.version}
            </dd>
          </div>
          <div>
            <dt>Schema source</dt>
            <dd>
              {review.export_profile.schema_source === "TEMPLATE"
                ? "Template-discovered"
                : "Configured POC schema"}
            </dd>
          </div>
          <div>
            <dt>Policy version</dt>
            <dd>v{review.policy_version}</dd>
          </div>
          <div>
            <dt>Client profile</dt>
            <dd>
              {review.client_profile_id
                ? `${review.client_profile_id.slice(0, 8)} · v${review.profile_version}`
                : "Session configuration"}
            </dd>
          </div>
        </dl>
        <div>
          <h3>Rule authority</h3>
          {review.active_rules.length ? (
            <ul>
              {review.active_rules.map((rule) => (
                <li key={`${rule.rule_id}-${rule.version}`}>
                  <strong>
                    {rule.rule_id} v{rule.version}
                  </strong>
                  <span>
                    {rule.action_authority.replaceAll("_", " ")} · zero
                    automatic reconciliations
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No active reusable rules for this session.</p>
          )}
        </div>
      </div>
      {!review.validation.valid && (
        <div
          className="validation-summary"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          <h3>Export is blocked</h3>
          <ul>
            {review.validation.issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div
          className="error-message"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          {error} Review the validation items and rerun the affected
          reconciliation stage.
        </div>
      )}
      <div className="mapping-actions">
        <div>
          <strong>
            {review.validation.valid
              ? "Current reconciliation state is exportable"
              : "Current state is stale or incomplete"}
          </strong>
          <span>Generating again creates a new immutable export version.</span>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={busy || !review.validation.valid}
        >
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Generating…" : "Generate Final Export"}
        </button>
      </div>
      <div className="export-history">
        <h3>Export history</h3>
        {history.length ? (
          <div className="results-table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Generated</th>
                  <th>Rows</th>
                  <th>Integrity reference</th>
                  <th>State</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.export_id}>
                    <td>v{item.version}</td>
                    <td>{new Date(item.created_at).toLocaleString()}</td>
                    <td>{format.format(item.row_count)}</td>
                    <td>
                      <code>{item.sha256.slice(0, 16)}…</code>
                    </td>
                    <td>
                      {item.stale
                        ? "Historical · current state changed"
                        : "Current"}
                    </td>
                    <td>
                      <a
                        className="button-link"
                        href={api.exportDownloadUrl(
                          reconciliationId,
                          item.export_id,
                        )}
                      >
                        Download .xlsx
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No exports generated. Generation only occurs when you use the button
            above.
          </p>
        )}
      </div>
    </section>
  );
}
