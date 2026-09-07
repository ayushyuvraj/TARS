import { FormEvent, useEffect, useRef, useState } from "react";
import { api, CopilotMessage } from "./api";

export function CopilotPanel({ reconciliationId, selectedRecordId }: {
  reconciliationId: string;
  selectedRecordId: string | null;
}) {
  const storageKey = `gst-copilot-${reconciliationId}`;
  const [conversationId, setConversationId] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;
    api.copilotConversation(reconciliationId, conversationId)
      .then(result => setMessages(result.messages))
      .catch(() => { localStorage.removeItem(storageKey); setConversationId(null); });
  }, [conversationId, reconciliationId, storageKey]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages]);

  const ask = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true); setError(null);
    const optimistic: CopilotMessage = { id: crypto.randomUUID(), conversation_id: conversationId ?? "", role: "user", content: message.trim(), selected_record_id: selectedRecordId, response: null, created_at: new Date().toISOString() };
    setMessages(current => [...current, optimistic]); setDraft("");
    try {
      const response = await api.askCopilot(reconciliationId, message.trim(), conversationId ?? undefined, selectedRecordId ?? undefined);
      if (!conversationId) { setConversationId(response.conversation_id); localStorage.setItem(storageKey, response.conversation_id); }
      setMessages(current => [...current, { id: response.id, conversation_id: response.conversation_id, role: "assistant", content: response.answer, selected_record_id: selectedRecordId, response, created_at: response.created_at }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Copilot could not complete the request."); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void ask(draft); };

  return <aside className="copilot-panel" aria-labelledby="copilot-title">
    <header><div><span className="eyebrow">Grounded assistant</span><h2 id="copilot-title">Copilot</h2></div><span className="copilot-state"><span aria-hidden="true" />Tool connected</span></header>
    {selectedRecordId && <div className="copilot-context" role="status" aria-atomic="true"><small>Selected record</small><strong>{selectedRecordId}</strong></div>}
    <div className="copilot-log" ref={logRef} aria-live="polite">
      {messages.length === 0 && <div className="copilot-empty"><strong>Ask about this reconciliation</strong><p>Answers are calculated from persisted records, candidates, variances, and policy—not guessed from chat.</p><div>{["Why are 240 Government records still unresolved?", "Show GST-only transactions."].map(prompt => <button className="button-secondary" key={prompt} onClick={() => void ask(prompt)}>{prompt}</button>)}</div></div>}
      {messages.map(message => <article className={`copilot-message copilot-message--${message.role}`} key={message.id}><span>{message.role === "user" ? "You" : "Copilot"}</span><p>{message.content}</p>{message.response && <><details><summary>Evidence · {message.response.evidence.length}</summary>{message.response.evidence.map(item => <div className="evidence-reference" key={`${item.reference_type}-${item.reference_id}`}><strong>{item.reference_type.replaceAll("_", " ")}</strong><small>{item.reference_id}</small></div>)}</details><details><summary>Activity · {message.response.tool_calls.length} tools</summary>{message.response.tool_calls.map(call => <div className="tool-trace" key={`${message.id}-${call.tool_name}`}><strong>{call.tool_name.replaceAll("_", " ")}</strong><small>{call.purpose} · {call.duration_ms.toFixed(0)} ms</small></div>)}</details></>}</article>)}
      {busy && <div className="copilot-thinking" role="status"><span className="spinner" aria-hidden="true" />Retrieving verified evidence…</div>}
    </div>
    {error && <p className="copilot-error" role="alert">{error}</p>}
    <form onSubmit={submit}><label htmlFor="copilot-question">Ask Copilot</label><textarea id="copilot-question" value={draft} onChange={event => setDraft(event.target.value)} placeholder={selectedRecordId ? `Ask about ${selectedRecordId}…` : "Ask about this reconciliation…"} rows={3} disabled={busy} /><button disabled={busy || !draft.trim()}>Send question</button></form>
  </aside>;
}
