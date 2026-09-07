import { useDeferredValue, useState } from "react";
import {
  CanonicalFieldDefinition,
  ColumnMappingCandidate,
  DatasetMappingProposal,
  DatasetProfile,
  DatasetRole,
  MappingValidationIssue,
  SchemaMappingProposal
} from "./api";

type MappingEditorProps = {
  proposal: SchemaMappingProposal;
  profiles: Partial<Record<DatasetRole, DatasetProfile>>;
  canonicalFields: CanonicalFieldDefinition[];
  disabled: boolean;
  onChange: (datasets: DatasetMappingProposal[]) => void;
};

const datasetLabels: Record<DatasetRole, string> = {
  government: "Government GST",
  purchase_register: "Purchase Register"
};

function confidenceState(mapping: ColumnMappingCandidate) {
  if (mapping.user_edited) return { label: "User edited", className: "confidence--edited" };
  if (mapping.canonical_field === null) return { label: "Unmapped", className: "confidence--unmapped" };
  if (mapping.confidence >= 0.9) return { label: "High", className: "confidence--high" };
  if (mapping.confidence >= 0.7) return { label: "Review", className: "confidence--medium" };
  return { label: "Low", className: "confidence--low" };
}

function rowIssues(
  issues: MappingValidationIssue[],
  role: DatasetRole,
  mapping: ColumnMappingCandidate
) {
  return issues.filter(
    (issue) =>
      issue.source_dataset === role &&
      (issue.source_column === mapping.source_column ||
        (issue.source_column === null && issue.canonical_field === mapping.canonical_field))
  );
}

export function MappingEditor({
  proposal,
  profiles,
  canonicalFields,
  disabled,
  onChange
}: MappingEditorProps) {
  const [query, setQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const updateRow = (role: DatasetRole, sourceColumn: string, canonicalField: string) => {
    onChange(
      proposal.datasets.map((dataset) => ({
        ...dataset,
        mappings: dataset.mappings.map((mapping) =>
          dataset.source_dataset === role && mapping.source_column === sourceColumn
            ? {
                ...mapping,
                canonical_field: canonicalField || null,
                confidence: 1,
                rationale: "User selected this canonical field.",
                proposed_by: "human",
                user_edited: true
              }
            : mapping
        )
      }))
    );
  };

  return (
    <div className="mapping-datasets">
      <div className="mapping-toolbar">
        <label htmlFor="mapping-search">Find a source field</label>
        <input id="mapping-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search source, concept, or rationale" />
        <label className="review-filter"><input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} /> Show attention items only</label>
      </div>
      {proposal.datasets.map((dataset) => {
        const profileByColumn = Object.fromEntries(
          (profiles[dataset.source_dataset]?.column_profiles ?? []).map((profile) => [
            profile.column_name,
            profile
          ])
        );
        const visibleMappings = dataset.mappings.filter((mapping) => {
          const confidence = confidenceState(mapping);
          const matchesQuery = !deferredQuery || `${mapping.source_column} ${mapping.canonical_field ?? ""} ${mapping.rationale}`.toLowerCase().includes(deferredQuery);
          return matchesQuery && (!reviewOnly || confidence.label === "Review" || confidence.label === "Low" || confidence.label === "Unmapped");
        });
        return (
          <section className="mapping-panel" key={dataset.source_dataset}>
            <div className="mapping-panel__heading">
              <div>
                <h2>{datasetLabels[dataset.source_dataset]}</h2>
                <p>{profiles[dataset.source_dataset]?.column_count ?? dataset.mappings.length} source columns profiled</p>
              </div>
              <span>{profiles[dataset.source_dataset]?.row_count.toLocaleString("en-IN")} rows</span>
            </div>
            <div className="mapping-table-wrap">
              <table className="mapping-table">
                <thead>
                  <tr>
                    <th scope="col">Source column</th>
                    <th scope="col">Canonical concept</th>
                    <th scope="col">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMappings.map((mapping) => {
                    const profile = profileByColumn[mapping.source_column];
                    const issues = rowIssues(
                      proposal.validation.issues,
                      dataset.source_dataset,
                      mapping
                    );
                    const confidence = confidenceState(mapping);
                    const errorId = `${dataset.source_dataset}-${mapping.source_column}-error`.replaceAll(" ", "-");
                    return (
                      <tr className={issues.length ? "mapping-row mapping-row--invalid" : "mapping-row"} key={mapping.source_column}>
                        <td>
                          <strong>{mapping.source_column}</strong>
                          <span>{profile?.inferred_dtype ?? "unknown"} · {profile?.non_null_percentage ?? 0}% populated</span>
                          {profile?.sample_values[0] && <small>Example: {profile.sample_values[0]}</small>}
                        </td>
                        <td>
                          <label className="sr-only" htmlFor={`${dataset.source_dataset}-${mapping.source_column}`}>
                            Canonical concept for {mapping.source_column}
                          </label>
                          <select
                            id={`${dataset.source_dataset}-${mapping.source_column}`}
                            value={mapping.canonical_field ?? ""}
                            onChange={(event) =>
                              updateRow(dataset.source_dataset, mapping.source_column, event.target.value)
                            }
                            disabled={disabled}
                            aria-invalid={issues.length > 0}
                            aria-describedby={issues.length ? errorId : undefined}
                          >
                            <option value="">Unused / unmapped</option>
                            {canonicalFields.map((field) => (
                              <option value={field.canonical_name} key={field.canonical_name}>
                                {field.display_name}{field.required_for_exact_match ? " *" : ""}
                              </option>
                            ))}
                          </select>
                          <span className="mapping-rationale">{mapping.rationale}</span>
                          {issues.length > 0 && (
                            <span className="field-error" id={errorId}>
                              {issues.map((issue) => issue.message).join(" ")}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`confidence ${confidence.className}`}>
                            {confidence.label} · {Math.round(mapping.confidence * 100)}%
                          </span>
                          <small>{mapping.proposed_by}</small>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleMappings.length === 0 && <tr><td colSpan={3} className="mapping-empty">No fields match the current filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
