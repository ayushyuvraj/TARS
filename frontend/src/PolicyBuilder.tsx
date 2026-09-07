import { CanonicalFieldDefinition, MatchOperator, PolicyFieldRule, PolicyProposal, ReconciliationPolicy } from "./api";

const policyFields = ["gstin", "document_number", "taxable_value", "document_date", "igst", "cgst", "sgst"];
const operatorLabels: Record<MatchOperator, string> = {
  EXACT: "Exact",
  ABSOLUTE_TOLERANCE: "Absolute tolerance",
  DATE_TOLERANCE: "Date tolerance"
};

function emptyRule(field: string, priority: number): PolicyFieldRule {
  return { canonical_field: field, enabled: false, required: false, operator: "EXACT", priority, tolerance: null, weight: null };
}

export function PolicyBuilder({ proposal, canonicalFields, disabled, onChange }: {
  proposal: PolicyProposal;
  canonicalFields: CanonicalFieldDefinition[];
  disabled: boolean;
  onChange: (policy: ReconciliationPolicy) => void;
}) {
  const definitions = Object.fromEntries(canonicalFields.map((field) => [field.canonical_name, field]));
  const rules = policyFields.map((field, index) => proposal.policy.rules.find((rule) => rule.canonical_field === field) ?? emptyRule(field, index + 1));
  const update = (next: PolicyFieldRule) => {
    const current = proposal.policy.rules.filter((rule) => rule.canonical_field !== next.canonical_field);
    onChange({ ...proposal.policy, rules: [...current, next].sort((a, b) => a.priority - b.priority), proposed_by: "human", status: "awaiting_approval" });
  };

  return (
    <div className="policy-rule-list">
      {rules.map((rule) => {
        const definition = definitions[rule.canonical_field];
        const issues = proposal.validation.issues.filter((issue) => issue.canonical_field === rule.canonical_field);
        const errorId = `policy-${rule.canonical_field}-error`;
        return (
          <fieldset className={`policy-rule${issues.length ? " policy-rule--invalid" : ""}`} key={rule.canonical_field} disabled={disabled}>
            <legend className="sr-only">{definition?.display_name ?? rule.canonical_field} rule</legend>
            <label className="toggle-control">
              <input type="checkbox" checked={rule.enabled} onChange={(event) => update({ ...rule, enabled: event.target.checked })} />
              <span aria-hidden="true" />
              <strong>{definition?.display_name ?? rule.canonical_field}</strong>
            </label>
            <div className="policy-control">
              <label htmlFor={`operator-${rule.canonical_field}`}>Operator</label>
              <select id={`operator-${rule.canonical_field}`} value={rule.operator} disabled={disabled || !rule.enabled}
                aria-invalid={issues.length > 0} aria-describedby={issues.length ? errorId : undefined}
                onChange={(event) => {
                  const operator = event.target.value as MatchOperator;
                  const tolerance = operator === "ABSOLUTE_TOLERANCE" ? { value: 10, unit: "INR" as const }
                    : operator === "DATE_TOLERANCE" ? { value: 5, unit: "DAYS" as const } : null;
                  update({ ...rule, operator, tolerance });
                }}>
                {Object.entries(operatorLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </div>
            <label className="required-control">
              <input type="checkbox" checked={rule.required} disabled={disabled || !rule.enabled} onChange={(event) => update({ ...rule, required: event.target.checked })} />
              Required
            </label>
            {rule.operator !== "EXACT" && (
              <div className="policy-control tolerance-control">
                <label htmlFor={`tolerance-${rule.canonical_field}`}>Tolerance</label>
                <div><span>{rule.operator === "ABSOLUTE_TOLERANCE" ? "₹" : "±"}</span><input id={`tolerance-${rule.canonical_field}`} type="number" min="0" step="1"
                  value={Number(rule.tolerance?.value ?? 0)} disabled={disabled || !rule.enabled}
                  onChange={(event) => update({ ...rule, tolerance: { value: Number(event.target.value), unit: rule.operator === "ABSOLUTE_TOLERANCE" ? "INR" : "DAYS" } })} />
                  <span>{rule.operator === "DATE_TOLERANCE" ? "days" : "INR"}</span></div>
              </div>
            )}
            <div className="rule-status"><span>{rule.enabled ? "Enabled" : "Optional · disabled"}</span><small>{definition?.expected_datatype}</small></div>
            {issues.length > 0 && <p className="field-error policy-field-error" id={errorId}>{issues.map((issue) => issue.message).join(" ")}</p>}
          </fieldset>
        );
      })}
    </div>
  );
}

export function PolicyPreview({ policy }: { policy: ReconciliationPolicy }) {
  return (
    <div className="policy-preview">
      <div><span className="eyebrow">Proposed policy</span><strong>{policy.name}</strong><small>Revision {policy.revision} · {policy.proposed_by === "ai" ? "AI-proposed" : policy.proposed_by === "deterministic" ? "Deterministically proposed" : "User configured"}</small></div>
      <ul>{policy.rules.filter((rule) => rule.enabled).map((rule) => <li key={rule.canonical_field}><span>{rule.canonical_field.replaceAll("_", " ")}</span><strong>{rule.operator === "EXACT" ? "Exact match required" : rule.operator === "ABSOLUTE_TOLERANCE" ? `± ₹${Number(rule.tolerance?.value ?? 0).toLocaleString("en-IN")}` : `± ${Number(rule.tolerance?.value ?? 0)} days`}</strong></li>)}</ul>
    </div>
  );
}
