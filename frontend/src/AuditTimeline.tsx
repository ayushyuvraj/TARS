import { useMemo, useState } from "react";
import { AuditEvent } from "./api";

const groups = [
  "ALL",
  "DATA",
  "SCHEMA",
  "POLICY",
  "MATCHING",
  "AI",
  "HUMAN_DECISIONS",
  "RULES",
  "PROFILE",
  "COPILOT",
] as const;
type Group = (typeof groups)[number];
function category(event: AuditEvent): Group {
  const value = `${event.event_type} ${event.component}`.toLowerCase();
  if (value.includes("rule") || value.includes("pattern")) return "RULES";
  if (value.includes("profile")) return "PROFILE";
  if (value.includes("copilot")) return "COPILOT";
  if (
    event.actor_type === "user" ||
    value.includes("approved") ||
    value.includes("decision")
  )
    return "HUMAN_DECISIONS";
  if (
    value.includes("semantic") ||
    value.includes("provider") ||
    value.includes("agent")
  )
    return "AI";
  if (value.includes("mapping") || value.includes("schema")) return "SCHEMA";
  if (value.includes("policy")) return "POLICY";
  if (value.includes("match") || value.includes("candidate")) return "MATCHING";
  return "DATA";
}
export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  const [filter, setFilter] = useState<Group>("ALL");
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const visible = useMemo(
    () =>
      events.filter((event) => filter === "ALL" || category(event) === filter),
    [events, filter],
  );
  return (
    <section className="results audit-section" aria-labelledby="audit-title">
      <div className="section-heading">
        <div>
          <span className="step">A</span>
          <div>
            <h2 id="audit-title">Audit Timeline</h2>
            <p>
              Real persisted events with safe structured detail; no model
              chain-of-thought
            </p>
          </div>
        </div>
      </div>
      <div
        className="audit-filters"
        role="group"
        aria-label="Filter audit timeline"
      >
        {groups.map((group) => (
          <button
            key={group}
            aria-pressed={filter === group}
            className={filter === group ? "active" : ""}
            onClick={() => setFilter(group)}
          >
            {group.replaceAll("_", " ")}
          </button>
        ))}
      </div>
      <div className="audit-layout">
        <ol className="audit-list">
          {visible.map((event) => (
            <li key={event.id}>
              <span className="audit-marker" aria-hidden="true" />
              <button onClick={() => setSelected(event)}>
                <strong>{event.event_type}</strong>
                <span>
                  {event.component} ·{" "}
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </button>
              {event.output_count !== null && (
                <span>{event.output_count} output</span>
              )}
            </li>
          ))}
        </ol>
        {selected && (
          <aside className="audit-detail">
            <button
              className="button-secondary button-compact"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
            <span className="governance-status">{category(selected)}</span>
            <h3>{selected.event_type}</h3>
            <dl>
              <div>
                <dt>Actor</dt>
                <dd>{selected.actor_type}</dd>
              </div>
              <div>
                <dt>Component</dt>
                <dd>{selected.component}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd>{new Date(selected.timestamp).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>{selected.result ?? "—"}</dd>
              </div>
            </dl>
            <details className="audit-raw">
              <summary>View structured event detail</summary>
              <pre>{JSON.stringify(selected.metadata, null, 2)}</pre>
            </details>
          </aside>
        )}
      </div>
    </section>
  );
}
