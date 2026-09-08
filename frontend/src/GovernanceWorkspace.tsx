import { useEffect, useState } from "react";
import {
  api,
  ClientProfile,
  PatternSuggestion,
  RuleSimulation,
  RuleVersion,
} from "./api";

type View = "profiles" | "patterns" | "rules";

export function GovernanceWorkspace({
  reconciliationId,
  onAuditChanged,
  initialView = "profiles",
}: {
  reconciliationId?: string | null;
  onAuditChanged: () => void;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [patterns, setPatterns] = useState<PatternSuggestion[]>([]);
  const [rules, setRules] = useState<RuleVersion[]>([]);
  const [selectedRule, setSelectedRule] = useState<RuleVersion | null>(null);
  const [simulation, setSimulation] = useState<RuleSimulation | null>(null);
  const [clientName, setClientName] = useState("ABC Ltd");
  const [profileName, setProfileName] = useState(
    "ABC Ltd GST Purchase Reconciliation",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const [savedProfiles, savedPatterns, savedRules] = await Promise.all([
      api.profiles(),
      reconciliationId ? api.patterns(reconciliationId) : Promise.resolve([]),
      api.rules(),
    ]);
    setProfiles(savedProfiles);
    setPatterns(savedPatterns);
    setRules(savedRules);
    const attached = reconciliationId
      ? (savedProfiles.find(
          (item) => item.created_from_reconciliation_id === reconciliationId,
        ) ?? savedProfiles[0] ?? null)
      : (savedProfiles[0] ?? null);
    setProfile(attached);
    if (savedRules.length && !selectedRule) {
      setSelectedRule(savedRules[0]);
    }
  };
  useEffect(() => {
    void load();
  }, [reconciliationId]);
  useEffect(() => {
    setView(initialView);
  }, [initialView]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await load();
      onAuditChanged();
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Governance action failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveProfile = () =>
    act(async () => {
      if (!reconciliationId) throw new Error("Save a reconciliation first.");
      const created = await api.createProfile(
        reconciliationId,
        clientName,
        profileName,
      );
      setProfile(created);
      setNotice("Client profile saved independently from this reconciliation.");
    });
  const detect = () =>
    act(async () => {
      if (!reconciliationId) throw new Error("No active reconciliation session.");
      const found = await api.detectPatterns(reconciliationId);
      setPatterns(found);
      setView("patterns");
      setNotice(
        found.length
          ? `${found.length} governed pattern suggestion available.`
          : "No pattern met the minimum evidence threshold.",
      );
    });
  const createRule = (patternId: string) =>
    act(async () => {
      if (!profile) throw new Error("Save a client profile first.");
      if (!reconciliationId) throw new Error("No active reconciliation session.");
      const draft = await api.patternToRule(
        reconciliationId,
        patternId,
        profile.id,
      );
      setSelectedRule(draft);
      setView("rules");
      setNotice(
        `${draft.rule_id} v${draft.version} created as DRAFT. It cannot execute.`,
      );
    });
  const simulate = (rule: RuleVersion) =>
    act(async () => {
      setSelectedRule(rule);
      if (!reconciliationId) throw new Error("No active reconciliation session.");
      setSimulation(await api.simulateRule(rule.rule_id, reconciliationId));
    });
  const approve = (rule: RuleVersion) =>
    act(async () => {
      setSelectedRule(await api.approveRule(rule.rule_id));
      setNotice(`${rule.rule_id} approved by the POC user.`);
    });
  const activate = (rule: RuleVersion) =>
    act(async () => {
      setSelectedRule(await api.activateRule(rule.rule_id));
      setNotice(
        `${rule.rule_id} activated. Historical sessions retain their recorded versions.`,
      );
    });
  const useProfile = (item: ClientProfile) =>
    act(async () => {
      const session = await api.newFromProfile(item.id);
      location.href = `/reconciliations/${session.id}/setup?profile=${item.id}`;
    });

  return (
    <section
      className="results governance-workspace"
      aria-labelledby="governance-title"
    >
      <div className="section-heading">
        <div>
          <span className="step">07</span>
          <div>
            <h2 id="governance-title">Governance & reusable intelligence</h2>
            <p>
              Patterns suggest. Humans approve. Active rules remain
              proposal-only and never reconcile automatically.
            </p>
          </div>
        </div>
        <button disabled={busy} onClick={detect}>
          Detect decision patterns
        </button>
      </div>
      <nav className="governance-nav" aria-label="Governance sections">
        {(["profiles", "patterns", "rules"] as View[]).map((item) => (
          <button
            key={item}
            aria-pressed={view === item}
            className={view === item ? "active" : ""}
            onClick={() => setView(item)}
          >
            {item === "profiles"
              ? "Client Profiles"
              : item === "patterns"
                ? "Pattern Suggestions"
                : "Rule Library"}
          </button>
        ))}
      </nav>
      {notice && (
        <div className="exception-notice" role="status" aria-atomic="true">
          {notice}
        </div>
      )}
      {view === "profiles" && (
        <div className="governance-grid">
          <div className="governance-form">
            <h3>Save as Client Profile</h3>
            <label htmlFor="client-name">Client</label>
            <input
              id="client-name"
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
            />
            <label htmlFor="profile-name">Profile name</label>
            <input
              id="profile-name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
            />
            <p>
              Includes the confirmed schema mapping and policy. Existing results
              are never copied.
            </p>
            <button
              disabled={busy || !clientName.trim() || !profileName.trim()}
              onClick={saveProfile}
            >
              Save as Client Profile
            </button>
          </div>
          <div className="governance-list">
            <h3>Client Profiles</h3>
            {profiles.length === 0 ? (
              <p>No reusable profiles saved yet.</p>
            ) : (
              profiles.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.client_name}</strong>
                    <span>{item.profile_name}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Profile</dt>
                      <dd>v{item.version}</dd>
                    </div>
                    <div>
                      <dt>Policy</dt>
                      <dd>v{item.saved_policy.revision}</dd>
                    </div>
                    <div>
                      <dt>Active rules</dt>
                      <dd>{item.active_rule_ids.length}</dd>
                    </div>
                  </dl>
                  <button
                    className="button-secondary"
                    onClick={() => void useProfile(item)}
                  >
                    Use for New Reconciliation
                  </button>
                </article>
              ))
            )}
          </div>
        </div>
      )}
      {view === "patterns" && (
        <div className="governance-list">
          <h3>Pattern Suggestions</h3>
          {patterns.length === 0 ? (
            <div className="empty-policy">
              <strong>No governed suggestions</strong>
              <p>At least five consistent comparable decisions are required.</p>
            </div>
          ) : (
            patterns.map((item) => (
              <article key={item.id}>
                <div>
                  <span className="governance-status">{item.disposition}</span>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                </div>
                <dl>
                  <div>
                    <dt>Observations</dt>
                    <dd>{item.observation_count}</dd>
                  </div>
                  <div>
                    <dt>Acceptance</dt>
                    <dd>{Math.round(item.acceptance_ratio * 100)}%</dd>
                  </div>
                  <div>
                    <dt>Impact</dt>
                    <dd>{item.estimated_impact}</dd>
                  </div>
                </dl>
                <details>
                  <summary>View evidence examples</summary>
                  <ul>
                    {item.evidence.slice(0, 5).map((evidence) => (
                      <li key={evidence.record_id}>
                        {evidence.record_id} ↔ {evidence.counterpart_id}:{" "}
                        {evidence.observation}
                      </li>
                    ))}
                  </ul>
                </details>
                {item.disposition === "NEW" && (
                  <button
                    disabled={busy || !profile}
                    onClick={() => void createRule(item.id)}
                  >
                    Create Draft Rule
                  </button>
                )}
              </article>
            ))
          )}
        </div>
      )}
      {view === "rules" && (
        <div className="governance-grid">
          <div className="governance-list">
            <h3>Rule Library</h3>
            {rules.length === 0 ? (
              <p>No rules created yet.</p>
            ) : (
              rules.map((rule) => (
                <button
                  className={
                    selectedRule?.rule_id === rule.rule_id
                      ? "rule-row active"
                      : "rule-row"
                  }
                  key={rule.rule_id}
                  onClick={() => {
                    setSelectedRule(rule);
                    setSimulation(null);
                  }}
                >
                  <span>
                    <strong>
                      {rule.rule_id} v{rule.version}
                    </strong>
                    {rule.name}
                  </span>
                  <span className="governance-status">{rule.status}</span>
                </button>
              ))
            )}
          </div>
          {selectedRule && (
            <aside className="rule-detail">
              <span className="governance-status">{selectedRule.status}</span>
              <h3>{selectedRule.name}</h3>
              <p>{selectedRule.description}</p>
              <h4>Why this rule exists</h4>
              <p>{selectedRule.provenance.summary}</p>
              <dl>
                <div>
                  <dt>Source</dt>
                  <dd>{selectedRule.provenance.type.replaceAll("_", " ")}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>{selectedRule.provenance.decision_count} decisions</dd>
                </div>
                <div>
                  <dt>Authority</dt>
                  <dd>{selectedRule.action_authority.replaceAll("_", " ")}</dd>
                </div>
                <div>
                  <dt>Action</dt>
                  <dd>{selectedRule.action.type.replaceAll("_", " ")}</dd>
                </div>
              </dl>
              <p className="authority-note">
                This rule may propose candidates only. It cannot create an automatic reconciliation.
              </p>
              <div className="rule-actions">
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => void simulate(selectedRule)}
                >
                  Simulate
                </button>
                {selectedRule.status === "DRAFT" && (
                  <button
                    disabled={busy}
                    onClick={() => void approve(selectedRule)}
                  >
                    Approve
                  </button>
                )}
                {selectedRule.status === "APPROVED" && (
                  <button
                    disabled={busy}
                    onClick={() => void activate(selectedRule)}
                  >
                    Activate
                  </button>
                )}
              </div>
              {simulation && (
                <div className="simulation-card">
                  <strong>Read-only simulation</strong>
                  <span>{simulation.would_propose} would be proposed</span>
                  <span>
                    {simulation.correct_known_approvals} known approvals
                  </span>
                  <span>
                    {simulation.potential_new_cases} potential new cases
                  </span>
                  <span>{simulation.conflicts} conflicts</span>
                  {simulation.activation_blocked && <b>Activation blocked</b>}
                </div>
              )}
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
