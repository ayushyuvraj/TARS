import React, { FormEvent, useEffect, useRef, useState } from "react";
import { api, CopilotMessage, CopilotMessageContext } from "./api";
import { copilotV2Bridge, V2WorkspaceContext } from "./copilot_v2_bridge";
import { Trash2, Paperclip, FileSpreadsheet, X } from "lucide-react";

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
  const [v2Context, setV2Context] = useState<V2WorkspaceContext | null>(() => copilotV2Bridge.getContext());

  useEffect(() => {
    return copilotV2Bridge.subscribe((ctx) => {
      setV2Context(ctx);
    });
  }, []);

  const effectiveSessionId = v2Context?.sessionId || reconciliationId;
  const storageKey = effectiveSessionId ? `gst-copilot-${effectiveSessionId}` : "gst-copilot-global";
  const msgStorageKey = effectiveSessionId ? `gst-copilot-msgs-${effectiveSessionId}` : "gst-copilot-msgs-global";
  const UNIFIED_STORAGE_KEY = "tars_copilot_unified_history_v2";

  const [conversationId, setConversationId] = useState<string | null>(() => localStorage.getItem(storageKey));
  const [messages, setMessages] = useState<CopilotMessage[]>(() => {
    try {
      const saved = localStorage.getItem(UNIFIED_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      // Fallback to legacy key if present
      const legacySaved = localStorage.getItem(msgStorageKey);
      if (legacySaved) {
        const parsedLegacy = JSON.parse(legacySaved);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) return parsedLegacy;
      }
    } catch {}
    return [];
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(UNIFIED_STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  useEffect(() => {
    if (!conversationId || !effectiveSessionId || v2Context || messages.length > 0) return;
    api.copilotConversation(effectiveSessionId, conversationId)
      .then(result => {
        if (result.messages && result.messages.length > 0) {
          setMessages(result.messages);
        }
      })
      .catch(() => { localStorage.removeItem(storageKey); setConversationId(null); });
  }, [conversationId, effectiveSessionId, storageKey, v2Context, messages.length]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, thinkingStatus]);

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const newFiles = Array.from(event.target.files);
      setAttachedFiles((prev) => [...prev, ...newFiles].slice(0, 2));
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const classifyFiles = (files: File[]) => {
    if (files.length === 0) return { gstr: null, pr: null };
    if (files.length === 1) {
      const f = files[0];
      const name = f.name.toLowerCase();
      if (name.includes("pr") || name.includes("purchase") || name.includes("erp")) {
        return { gstr: null, pr: f };
      }
      return { gstr: f, pr: null };
    }
    const f1 = files[0];
    const f2 = files[1];
    const n1 = f1.name.toLowerCase();
    const n2 = f2.name.toLowerCase();

    if (n1.includes("gstr") || n1.includes("gov") || n1.includes("portal") || n2.includes("pr") || n2.includes("purchase")) {
      return { gstr: f1, pr: f2 };
    }
    if (n2.includes("gstr") || n2.includes("gov") || n2.includes("portal") || n1.includes("pr") || n1.includes("purchase")) {
      return { gstr: f2, pr: f1 };
    }
    return { gstr: f1, pr: f2 };
  };

  const ask = async (message: string) => {
    const finalMessage = message.trim() || (attachedFiles.length > 0 ? "reconcile" : "");
    if (!finalMessage || busy) return;

    setBusy(true);
    setError(null);
    setThinkingStatus("Processing instruction…");

    const currentContext: CopilotMessageContext = {
      sessionId: v2Context?.sessionId || effectiveSessionId || null,
      sessionTitle: v2Context?.gstrFilename ? `${v2Context.gstrFilename} vs ${v2Context.prFilename || 'PR'}` : null,
      stageKey: v2Context?.activeStage || null,
      stageNumber: v2Context?.stageNumber || null,
      stageLabel: v2Context?.stageLabel || (effectiveSessionId ? "Reconciliation Session" : "Global Screen"),
      routePath: currentPage || window.location.pathname,
      timestamp: new Date().toISOString(),
    };

    const optimistic: CopilotMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId ?? "",
      role: "user",
      content: attachedFiles.length > 0 ? `${finalMessage} (Attached: ${attachedFiles.map(f => f.name).join(", ")})` : finalMessage,
      selected_record_id: selectedRecordId,
      response: null,
      created_at: new Date().toISOString(),
      context: currentContext,
    };
    const nextMessages = [...messages, optimistic];
    setMessages(nextMessages);
    setDraft("");

    // Check if we are in Reconciliation v2.0 or have v2 context
    const isV2 = Boolean(v2Context || (currentPage && currentPage.includes("reconciliations-v2")));

    if (isV2) {
      const assistantId = crypto.randomUUID();
      const initialAssistantMsg: CopilotMessage = {
        id: assistantId,
        conversation_id: conversationId ?? "",
        role: "assistant",
        content: "",
        selected_record_id: selectedRecordId,
        response: null,
        created_at: new Date().toISOString(),
        context: currentContext,
      };
      setMessages([...nextMessages, initialAssistantMsg]);

      const hadAttachments = attachedFiles.length > 0;
      let accumulatedContent = "";

      try {
        let res: Response;

        // If files are attached, trigger autonomous pipeline endpoint
        if (attachedFiles.length > 0) {
          const filesToProcess = [...attachedFiles];
          setAttachedFiles([]);
          const { gstr, pr } = classifyFiles(filesToProcess);
          const formData = new FormData();
          if (gstr) formData.append("government_file", gstr);
          if (pr) formData.append("purchase_file", pr);
          if (v2Context?.sessionId || effectiveSessionId) {
            formData.append("session_id", v2Context?.sessionId || effectiveSessionId || "");
          }
          formData.append("prompt", finalMessage);

          res = await fetch("/api/reconciliations-v2/copilot/auto-reconcile", {
            method: "POST",
            body: formData,
          });
        } else {
          // Standard text / command stream with context-aware history
          const historyPayload = nextMessages.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
            context: m.context || null,
          }));
          res = await fetch("/api/reconciliations-v2/copilot/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: finalMessage,
              session_id: v2Context?.sessionId || effectiveSessionId,
              current_stage: v2Context?.activeStage || "setup",
              stage_context: v2Context,
              conversation_history: historyPayload,
            }),
          });
        }

        if (!res.ok || !res.body) {
          throw new Error(`Streaming request failed: HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.startsWith(":") || !trimmed.startsWith("data: ")) continue;
            const jsonStr = trimmed.slice(6);
            try {
              const data = JSON.parse(jsonStr);
              if (data.type === "token") {
                accumulatedContent += data.content;
                setMessages(current =>
                  current.map(m =>
                    m.id === assistantId ? { ...m, content: accumulatedContent } : m
                  )
                );
              } else if (data.type === "thought") {
                setThinkingStatus(data.message);
              } else if (data.type === "action") {
                copilotV2Bridge.dispatchAction({
                  action: data.action,
                  payload: data.payload,
                  status: data.status,
                });
              } else if (data.type === "done") {
                setThinkingStatus(null);
              }
            } catch (parseErr) {
              console.warn("SSE JSON parse error:", parseErr);
            }
          }
        }
      } catch (reason) {
        console.warn("V2 streaming error, falling back:", reason);
        if (hadAttachments || accumulatedContent.length > 0) {
          setError(reason instanceof Error ? reason.message : "Autonomous reconcile failed.");
          setMessages(current =>
            current.map(m =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      accumulatedContent ||
                      "❌ **Reconciliation Failed**: Could not complete autonomous reconciliation. Please check server logs or workbook format.",
                  }
                : m
            )
          );
          return;
        }

        try {
          const response = await api.askCopilot(
            effectiveSessionId,
            finalMessage,
            conversationId ?? undefined,
            selectedRecordId ?? undefined,
            currentPage,
            nextMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          );
          setMessages(current =>
            current.map(m =>
              m.id === assistantId ? { ...m, content: response.answer, response } : m
            )
          );
        } catch (fbErr) {
          setError(fbErr instanceof Error ? fbErr.message : "Copilot could not complete the request.");
          setMessages(current =>
            current.map(m =>
              m.id === assistantId
                ? { ...m, content: "Could not retrieve response from Copilot server. Please verify backend service connectivity." }
                : m
            )
          );
        }
      } finally {
        setBusy(false);
        setThinkingStatus(null);
      }
      return;
    }

    // Standard V1 flow
    try {
      const historyPayload = nextMessages.slice(-8).map(m => ({ role: m.role, content: m.content }));
      const response = await api.askCopilot(
        reconciliationId,
        finalMessage,
        conversationId ?? undefined,
        selectedRecordId ?? undefined,
        currentPage,
        historyPayload,
      );
      if (!conversationId) {
        setConversationId(response.conversation_id);
        localStorage.setItem(storageKey, response.conversation_id);
      }
      setMessages(current => [
        ...current,
        {
          id: response.id,
          conversation_id: response.conversation_id,
          role: "assistant",
          content: response.answer,
          selected_record_id: selectedRecordId,
          response,
          created_at: response.created_at,
          context: currentContext,
        }
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Copilot could not complete the request.");
    } finally {
      setBusy(false);
      setThinkingStatus(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setThinkingStatus(null);
    setConversationId(null);
    setAttachedFiles([]);
    try {
      localStorage.removeItem(UNIFIED_STORAGE_KEY);
      localStorage.removeItem(storageKey);
      localStorage.removeItem(msgStorageKey);
    } catch {}
  };

  const getSamplePrompts = () => {
    if (v2Context) {
      if (v2Context.activeStage === "setup") {
        return ["What is this screen about?", "Reconcile", "Go forward to mapping"];
      }
      if (v2Context.activeStage === "mapping") {
        return [
          "Make sure Vendor Name is mapped to Supplier Legal Name",
          "Ignore mapping for Cess",
          "Go forward to rules"
        ];
      }
      if (v2Context.activeStage === "rules") {
        return [
          "Should I select this rule?",
          "Add rule regarding invoice date within 30 days",
          "Ignore rule R-04",
          "Go forward to results"
        ];
      }
      if (v2Context.activeStage === "results") {
        return [
          "Why is this record near match rather than tolerance?",
          "How many records are unresolved?",
          "Go forward to summary"
        ];
      }
      if (v2Context.activeStage === "summary" || v2Context.activeStage === "export") {
        return ["What is the total claimable ITC?", "How do I export results?", "Go back to rules"];
      }
    }
    if (reconciliationId) {
      return [
        "What is a Near Match?",
        "How many records are unresolved?",
        "What are the largest material mismatches?",
        "How do I export results?",
      ];
    }
    return [
      "How do I start a reconciliation?",
      "What is Quick Reconcile?",
      "What is Near Match?",
      "What does PR Only mean?",
    ];
  };

  const samplePrompts = getSamplePrompts();

  const getHeaderEyebrow = () => {
    if (v2Context) {
      return `Stage ${v2Context.stageNumber} · ${v2Context.activeStage.toUpperCase()}`;
    }
    return reconciliationId ? "Grounded assistant" : "Application guide";
  };

  const getHeaderState = () => {
    if (v2Context) {
      return `Stage ${v2Context.stageNumber} connected`;
    }
    return reconciliationId ? "Session connected" : "Global mode";
  };

  const getPlaceholder = () => {
    if (attachedFiles.length > 0) {
      return "Type 'reconcile' to run automated pre-flight & matching passes…";
    }
    if (selectedRecordId) return `Ask about ${selectedRecordId}…`;
    if (v2Context) {
      return `Ask about Stage ${v2Context.stageNumber} or type 'map X to Y', 'add rule...', 'go forward'…`;
    }
    if (reconciliationId) return "Ask about this reconciliation…";
    return "Ask TARS Copilot…";
  };

  return (
    <aside className="copilot-panel" aria-labelledby="copilot-title">
      <header>
        <div>
          <span className="eyebrow">{getHeaderEyebrow()}</span>
          <h2 id="copilot-title">TARS Copilot</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              title="Clear chat history"
              aria-label="Clear chat history"
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#cbd5e1",
                cursor: "pointer",
                padding: "3px 8px",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1.2,
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.18)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
            >
              <Trash2 size={12} />
              <span>Clear</span>
            </button>
          )}
          <span className="copilot-state">
            <span aria-hidden="true" />
            {getHeaderState()}
          </span>
        </div>
      </header>

      {selectedRecordId && (
        <div className="copilot-context" role="status" aria-atomic="true">
          <small>Selected record</small>
          <strong>{selectedRecordId}</strong>
        </div>
      )}

      {v2Context && !selectedRecordId && (
        <div className="copilot-context" role="status" aria-atomic="true">
          <small>Active screen</small>
          <strong>{v2Context.stageLabel}</strong>
        </div>
      )}

      <div className="copilot-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="copilot-empty">
            <strong>
              {v2Context
                ? `Copilot is active on ${v2Context.stageLabel}`
                : reconciliationId
                ? "Ask about this reconciliation"
                : "Welcome to TARS Copilot"}
            </strong>
            <p>
              {v2Context
                ? "Ask questions about this stage or issue instructions like 'map column X to Y', 'add rule...', or 'go forward'. You can also attach your workbooks below to auto-reconcile."
                : reconciliationId
                ? "Answers are calculated from persisted records, candidates, variances, and policy."
                : "Ask about TARS features, workflow navigation, or how to start a reconciliation."}
            </p>
            <div>
              {samplePrompts.map((prompt) => (
                <button
                  className="button-secondary"
                  key={prompt}
                  onClick={() => void ask(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, idx) => {
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const prevCtx = prevMsg?.context;
          const currCtx = message.context;

          const sessionSwitched = Boolean(
            prevCtx?.sessionId &&
            currCtx?.sessionId &&
            prevCtx.sessionId !== currCtx.sessionId
          );

          const stageSwitched = Boolean(
            !sessionSwitched &&
            prevCtx?.stageKey &&
            currCtx?.stageKey &&
            prevCtx.stageKey !== currCtx.stageKey
          );

          return (
            <React.Fragment key={message.id}>
              {sessionSwitched && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "12px 0 8px 0",
                    padding: "5px 12px",
                    background: "rgba(30, 41, 59, 0.85)",
                    borderRadius: "6px",
                    border: "1px dashed #475569",
                    color: "#94a3b8",
                    fontSize: "11px",
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }}
                >
                  <span>
                    🔄 <strong>Session Changed</strong>: from{" "}
                    <code style={{ color: "#38bdf8", padding: "1px 4px", background: "rgba(56, 189, 248, 0.1)", borderRadius: "3px" }}>
                      {prevCtx?.sessionId?.slice(0, 8)}
                    </code>{" "}
                    ({prevCtx?.stageLabel || prevCtx?.stageKey}) ➔{" "}
                    <code style={{ color: "#38bdf8", padding: "1px 4px", background: "rgba(56, 189, 248, 0.1)", borderRadius: "3px" }}>
                      {currCtx?.sessionId?.slice(0, 8)}
                    </code>{" "}
                    ({currCtx?.stageLabel || currCtx?.stageKey})
                  </span>
                </div>
              )}

              {stageSwitched && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "10px 0 6px 0",
                    padding: "4px 10px",
                    background: "rgba(15, 23, 42, 0.6)",
                    borderRadius: "4px",
                    border: "1px dotted #334155",
                    color: "#94a3b8",
                    fontSize: "10.5px",
                    fontWeight: 500,
                  }}
                >
                  <span>
                    🧭 <strong>Stage Switched</strong>: {prevCtx?.stageLabel || prevCtx?.stageKey} ➔{" "}
                    {currCtx?.stageLabel || currCtx?.stageKey}
                  </span>
                </div>
              )}

              <article
                className={`copilot-message copilot-message--${message.role}`}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span>{message.role === "user" ? "You" : "Copilot"}</span>
                  {currCtx && (currCtx.stageLabel || currCtx.sessionId) && (
                    <span
                      style={{
                        fontSize: "9px",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: message.role === "user" ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.15)",
                        color: message.role === "user" ? "#cbd5e1" : "#64748b",
                        fontWeight: 600,
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                      }}
                      title={`Session: ${currCtx.sessionId || "Global"} | Stage: ${currCtx.stageLabel || "N/A"}`}
                    >
                      {currCtx.stageLabel || (currCtx.sessionId ? `Sess: ${currCtx.sessionId.slice(0, 6)}…` : "Global")}
                    </span>
                  )}
                </div>
                {renderFormattedContent(message.content)}
                {message.response && (
                  <>
                    {message.response.evidence.length > 0 && (
                      <details>
                        <summary>View evidence · {message.response.evidence.length} facts</summary>
                        {message.response.provider && (
                          <div className="evidence-provider">
                            <small>
                              Provider: {message.response.provider}{" "}
                              {message.response.model ? `(${message.response.model})` : ""}
                            </small>
                          </div>
                        )}
                        {message.response.evidence.map((item) => (
                          <div
                            className="evidence-reference"
                            key={`${item.reference_type}-${item.reference_id}`}
                          >
                            <strong>{item.reference_type.replaceAll("_", " ")}</strong>
                            <small>{item.reference_id}</small>
                          </div>
                        ))}
                      </details>
                    )}
                    {message.response.tool_calls.length > 0 && (
                      <details>
                        <summary>Activity · {message.response.tool_calls.length} tools</summary>
                        {message.response.tool_calls.map((call) => (
                          <div
                            className="tool-trace"
                            key={`${message.id}-${call.tool_name}`}
                          >
                            <strong>{call.tool_name.replaceAll("_", " ")}</strong>
                            <small>
                              {call.purpose} · {call.duration_ms.toFixed(0)} ms
                            </small>
                          </div>
                        ))}
                      </details>
                    )}
                  </>
                )}
              </article>
            </React.Fragment>
          );
        })}

        {busy && thinkingStatus && (
          <div className="copilot-thinking" role="status">
            <span className="spinner" aria-hidden="true" />
            {thinkingStatus}
          </div>
        )}
      </div>

      {error && <p className="copilot-error" role="alert">{error}</p>}

      <form onSubmit={submit}>
        <label htmlFor="copilot-question">Ask Copilot</label>

        {/* Attached Workbooks Pills */}
        {attachedFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, padding: "6px 8px", background: "#172033", borderRadius: 8, border: "1px solid #334155" }}>
            {attachedFiles.map((f, i) => {
              const isGstr = f.name.toLowerCase().includes("gstr") || f.name.toLowerCase().includes("gov") || i === 0;
              return (
                <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(3, 105, 161, 0.35)", padding: "3px 8px", borderRadius: 6, fontSize: 11, color: "#e0f2fe", border: "1px solid rgba(56, 189, 248, 0.4)" }}>
                  <FileSpreadsheet size={13} style={{ color: "#38bdf8" }} />
                  <span style={{ fontWeight: 700, color: "#7dd3fc" }}>{isGstr && attachedFiles.length > 1 ? "GSTR-2B:" : "PR:"}</span>
                  <span style={{ maxWidth: 110, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{f.name}</span>
                  <button type="button" onClick={() => removeFile(i)} style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", padding: 0, display: "inline-flex" }}>
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <textarea
          id="copilot-question"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={getPlaceholder()}
          rows={3}
          disabled={busy}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach Excel workbooks (GSTR-2B / Purchase Register)"
              style={{
                background: attachedFiles.length > 0 ? "rgba(3, 105, 161, 0.4)" : "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.18)",
                color: attachedFiles.length > 0 ? "#7dd3fc" : "#cbd5e1",
                cursor: "pointer",
                padding: "6px 10px",
                borderRadius: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <Paperclip size={13} />
              <span>{attachedFiles.length === 0 ? "Attach Excel" : `${attachedFiles.length} file(s)`}</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={handleFilesSelected}
            />
          </div>

          <button disabled={busy || (!draft.trim() && attachedFiles.length === 0)}>
            {attachedFiles.length > 0 && !draft.trim() ? "Reconcile" : "Send"}
          </button>
        </div>
      </form>
    </aside>
  );
}
