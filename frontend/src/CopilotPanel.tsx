import { FormEvent, useEffect, useRef, useState } from "react";
import { api, CopilotMessage } from "./api";

function renderFormattedContent(text: string) {
  if (!text) return null;
  const cleaned = text
    .replaceAll("\\*\\*", "**")
    .replaceAll("\\-", "-")
    .replaceAll("&#x20;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
  const paragraphs = cleaned.split("\n\n").filter(p => p.trim());
  return (
    <div className="copilot-message-text">
      {paragraphs.map((p, idx) => (
        <p key={idx}>{p.trim()}</p>
      ))}
    </div>
  );
}

export function CopilotPanel({ reconciliationId, selectedRecordId, currentPage }: {
  reconciliationId: string | null;
  selectedRecordId: string | null;
  currentPage?: string;
}) {
  const storageKey = reconciliationId ? `gst-copilot-${reconciliationId}` : "gst-copilot-global";
  const msgStorageKey = reconciliationId ? `gst-copilot-msgs-${reconciliationId}` : "gst-copilot-msgs-global";

  const [conversationId, setConversationId] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [messages, setMessages] = useState<CopilotMessage[]>(() => {
    if (!reconciliationId) {
      try {
        const saved = localStorage.getItem(msgStorageKey);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reconciliationId) {
      try {
        localStorage.setItem(msgStorageKey, JSON.stringify(messages));
      } catch {}
    }
  }, [messages, reconciliationId, msgStorageKey]);

  useEffect(() => {
    if (!conversationId || !reconciliationId) return;
    api.copilotConversation(reconciliationId, conversationId)
      .then(result => setMessages(result.messages))
      .catch(() => { localStorage.removeItem(storageKey); setConversationId(null); });
  }, [conversationId, reconciliationId, storageKey]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages]);

  const ask = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true); setError(null);
    const optimistic: CopilotMessage = { id: crypto.randomUUID(), conversation_id: conversationId ?? "", role: "user", content: message.trim(), selected_record_id: selectedRecordId, response: null, created_at: new Date().toISOString() };
    const nextMessages = [...messages, optimistic];
    setMessages(nextMessages); setDraft("");
    try {
      const historyPayload = nextMessages.slice(-8).map(m => ({ role: m.role, content: m.content }));
      const response = await api.askCopilot(
        reconciliationId,
        message.trim(),
        conversationId ?? undefined,
        selectedRecordId ?? undefined,
        currentPage,
        historyPayload,
      );
      if (!conversationId) { setConversationId(response.conversation_id); localStorage.setItem(storageKey, response.conversation_id); }
      setMessages(current => [...current, { id: response.id, conversation_id: response.conversation_id, role: "assistant", content: response.answer, selected_record_id: selectedRecordId, response, created_at: response.created_at }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Copilot could not complete the request."); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void ask(draft); };

  const samplePrompts = reconciliationId ? [
    "What is a Near Match?",
    "How many records are unresolved?",
    "What are the largest material mismatches?",
    "How do I export results?",
  ] : [
    "How do I start a reconciliation?",
    "What is Quick Reconcile?",
    "What is Near Match?",
    "What does PR Only mean?",
  ];

  return <aside className="copilot-panel" aria-labelledby="copilot-title">
    <header>
      <div>
        <span className="eyebrow">{reconciliationId ? "Grounded assistant" : "Application guide"}</span>
        <h2 id="copilot-title">TARS Copilot</h2>
      </div>
      <span className="copilot-state"><span aria-hidden="true" />{reconciliationId ? "Session connected" : "Global mode"}</span>
    </header>
    {selectedRecordId && <div className="copilot-context" role="status" aria-atomic="true"><small>Selected record</small><strong>{selectedRecordId}</strong></div>}
    <div className="copilot-log" ref={logRef} aria-live="polite">
      {messages.length === 0 && <div className="copilot-empty">
        <strong>{reconciliationId ? "Ask about this reconciliation" : "Welcome to TARS Copilot"}</strong>
        <p>{reconciliationId ? "Answers are calculated from persisted records, candidates, variances, and policy." : "Ask about TARS features, workflow navigation, or how to start a reconciliation."}</p>
        <div>{samplePrompts.map(prompt => <button className="button-secondary" key={prompt} onClick={() => void ask(prompt)}>{prompt}</button>)}</div>
      </div>}
      {messages.map(message => <article className={`copilot-message copilot-message--${message.role}`} key={message.id}>
        <span>{message.role === "user" ? "You" : "Copilot"}</span>
        {renderFormattedContent(message.content)}
        {message.response && <>
          {message.response.evidence.length > 0 && <details><summary>View evidence · {message.response.evidence.length} facts</summary>
            {message.response.provider && <div className="evidence-provider"><small>Provider: {message.response.provider} {message.response.model ? `(${message.response.model})` : ""}</small></div>}
            {message.response.evidence.map(item => <div className="evidence-reference" key={`${item.reference_type}-${item.reference_id}`}><strong>{item.reference_type.replaceAll("_", " ")}</strong><small>{item.reference_id}</small></div>)}
          </details>}
          {message.response.tool_calls.length > 0 && <details><summary>Activity · {message.response.tool_calls.length} tools</summary>
            {message.response.tool_calls.map(call => <div className="tool-trace" key={`${message.id}-${call.tool_name}`}><strong>{call.tool_name.replaceAll("_", " ")}</strong><small>{call.purpose} · {call.duration_ms.toFixed(0)} ms</small></div>)}
          </details>}
        </>}
      </article>)}
      {busy && <div className="copilot-thinking" role="status"><span className="spinner" aria-hidden="true" />Retrieving guidance…</div>}
    </div>
    {error && <p className="copilot-error" role="alert">{error}</p>}
    <form onSubmit={submit}><label htmlFor="copilot-question">Ask Copilot</label><textarea id="copilot-question" value={draft} onChange={event => setDraft(event.target.value)} placeholder={selectedRecordId ? `Ask about ${selectedRecordId}…` : reconciliationId ? "Ask about this reconciliation…" : "Ask TARS Copilot…"} rows={3} disabled={busy} /><button disabled={busy || !draft.trim()}>Send question</button></form>
  </aside>;
}

