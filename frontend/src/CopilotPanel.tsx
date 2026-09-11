import React, { FormEvent, useEffect, useRef, useState } from "react";
import { api, CopilotMessage, CopilotMessageContext, CopilotTelemetryStep } from "./api";
import { copilotV2Bridge, V2WorkspaceContext } from "./copilot_v2_bridge";
import {
  Trash2,
  Paperclip,
  FileSpreadsheet,
  X,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Terminal,
  Send,
  Cpu,
  Layers,
  Database,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
} from "lucide-react";
import "./copilot_agentic.css";

export type CopilotDisplayMode = "closed" | "floating" | "fullscreen" | "pill" | "parallel" | "drawer";

interface CopilotPanelProps {
  reconciliationId: string | null;
  selectedRecordId: string | null;
  currentPage?: string;
  mode?: CopilotDisplayMode;
  onModeChange?: (mode: CopilotDisplayMode) => void;
  onClose?: () => void;
}

const CLI_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function renderFormattedContent(text: string) {
  if (!text) return null;
  const cleaned = text
    .replaceAll("\\*\\*", "**")
    .replaceAll("\\-", "-")
    .replaceAll("&#x20;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

  // Check for table structure
  const lines = cleaned.split("\n");
  const hasTable = lines.some((l) => l.trim().startsWith("|") && l.trim().endsWith("|"));

  if (hasTable) {
    const tableLines: string[] = [];
    const nonTableBlocks: string[][] = [];
    let currentBlock: string[] = [];
    let inTable = false;

    lines.forEach((line) => {
      const isTableLine = line.trim().startsWith("|") && line.trim().endsWith("|");
      if (isTableLine) {
        if (!inTable && currentBlock.length > 0) {
          nonTableBlocks.push(currentBlock);
          currentBlock = [];
        }
        inTable = true;
        tableLines.push(line);
      } else {
        if (inTable && tableLines.length > 0) {
          // parse table
          inTable = false;
        }
        currentBlock.push(line);
      }
    });
    if (currentBlock.length > 0) {
      nonTableBlocks.push(currentBlock);
    }
  }

  // Render paragraphs with bold and inline code formatting
  const paragraphs = cleaned.split("\n\n").filter((p) => p.trim());

  const formatSpan = (str: string) => {
    // Basic regex parser for inline code and bold
    const parts = str.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={i}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  return (
    <div className="tars-copilot-markdown">
      {paragraphs.map((p, idx) => {
        const trimmed = p.trim();
        if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
          // Table parsing
          const tRows = trimmed.split("\n").filter((r) => r.trim().startsWith("|"));
          if (tRows.length >= 2) {
            const headerCols = tRows[0].split("|").map((c) => c.trim()).filter(Boolean);
            const dataRows = tRows.slice(1).filter((r) => !r.includes("---")).map((r) =>
              r.split("|").map((c) => c.trim()).filter(Boolean)
            );
            return (
              <div key={idx} style={{ overflowX: "auto", margin: "8px 0" }}>
                <table>
                  <thead>
                    <tr>
                      {headerCols.map((col, cIdx) => (
                        <th key={cIdx}>{formatSpan(col)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx}>{formatSpan(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
        }
        if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
          const items = trimmed.split("\n").map((line) => line.replace(/^[\*\-]\s+/, "").trim());
          return (
            <ul key={idx} style={{ margin: "6px 0 10px 18px", padding: 0 }}>
              {items.map((item, iIdx) => (
                <li key={iIdx} style={{ margin: "3px 0", color: "#cbd5e1" }}>
                  {formatSpan(item)}
                </li>
              ))}
            </ul>
          );
        }
        return <p key={idx}>{formatSpan(trimmed)}</p>;
      })}
    </div>
  );
}

function ThoughtAccordion({
  thoughtContent,
  steps,
  durationMs,
}: {
  thoughtContent?: string;
  steps?: CopilotTelemetryStep[];
  durationMs?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const totalMs = durationMs || (steps && steps.length > 0 ? steps.reduce((acc, s) => acc + (s.duration_ms || 15), 0) : 2100);
  const seconds = (totalMs / 1000).toFixed(1);

  const hasThought = Boolean(thoughtContent && thoughtContent.trim().length > 0);
  const hasSteps = Boolean(steps && steps.length > 0);

  if (!hasThought && !hasSteps) return null;

  return (
    <div className="tars-copilot-thought-accordion">
      <button
        type="button"
        className="tars-copilot-thought-summary-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Toggle agent reasoning trace"
      >
        <div className="tars-copilot-thought-summary-left">
          <span className="glyph">{isOpen ? "▾" : "▸"}</span>
          <span>
            Reasoned in {seconds}s
            {hasSteps ? ` · ${steps!.length} operation${steps!.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#64748b" }}>
          <span>{isOpen ? "Hide trace" : "Show trace"}</span>
          {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </div>
      </button>

      {isOpen && (
        <div className="tars-copilot-thought-details">
          {hasThought && (
            <div className="tars-copilot-thought-raw">
              {renderFormattedContent(thoughtContent!)}
            </div>
          )}

          {hasSteps && (
            <div className="tars-copilot-thought-steps-list">
              {steps!.map((step) => (
                <div key={step.id} className="tars-copilot-telemetry-line">
                  <span className="step-glyph">›</span>
                  <span className="step-label">{step.label}</span>
                  {step.duration_ms && <span className="step-ms">[{step.duration_ms}ms]</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CopilotPanel({
  reconciliationId,
  selectedRecordId,
  currentPage,
  mode = "parallel",
  onModeChange,
  onClose,
}: CopilotPanelProps) {
  const [v2Context, setV2Context] = useState<V2WorkspaceContext | null>(() =>
    copilotV2Bridge.getContext()
  );

  useEffect(() => {
    return copilotV2Bridge.subscribe((ctx) => {
      setV2Context(ctx);
    });
  }, []);

  const effectiveSessionId = v2Context?.sessionId || reconciliationId;
  const storageKey = effectiveSessionId
    ? `gst-copilot-${effectiveSessionId}`
    : "gst-copilot-global";
  const msgStorageKey = effectiveSessionId
    ? `gst-copilot-msgs-${effectiveSessionId}`
    : "gst-copilot-msgs-global";
  const UNIFIED_STORAGE_KEY = "tars_copilot_unified_history_v2";

  const [conversationId, setConversationId] = useState<string | null>(() =>
    localStorage.getItem(storageKey)
  );

  const [messages, setMessages] = useState<CopilotMessage[]>(() => {
    try {
      const saved = localStorage.getItem(UNIFIED_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
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
  const [liveThought, setLiveThought] = useState<string>("");
  const [liveSteps, setLiveSteps] = useState<CopilotTelemetryStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("tars_copilot_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("tars_copilot_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  };

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("tars_copilot_theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {}
    return "light"; // Default to light (KPMG Cloud #f7f9fa) as requested
  });

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem("tars_copilot_theme", next);
      } catch {}
      return next;
    });
  };

  /* Interactive Resizing for Floating Overlapping Card */
  const DEFAULT_FLOATING_WIDTH = 420;
  const DEFAULT_FLOATING_HEIGHT = 640;
  const MIN_FLOATING_WIDTH = 370;
  const MIN_FLOATING_HEIGHT = 420;

  const [floatingSize, setFloatingSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = localStorage.getItem("tars_copilot_floating_size");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.width === "number" && typeof parsed.height === "number") {
          const maxW = typeof window !== "undefined" ? Math.max(MIN_FLOATING_WIDTH, window.innerWidth - 48) : 960;
          const maxH = typeof window !== "undefined" ? Math.max(MIN_FLOATING_HEIGHT, window.innerHeight - 48) : 850;
          return {
            width: Math.min(Math.max(parsed.width, MIN_FLOATING_WIDTH), maxW),
            height: Math.min(Math.max(parsed.height, MIN_FLOATING_HEIGHT), maxH),
          };
        }
      }
    } catch {}
    return { width: DEFAULT_FLOATING_WIDTH, height: DEFAULT_FLOATING_HEIGHT };
  });

  const [isResizing, setIsResizing] = useState<"nw" | "n" | "w" | null>(null);
  const resizeRef = useRef<{
    handle: "nw" | "n" | "w";
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const startResize = (e: React.PointerEvent, handle: "nw" | "n" | "w") => {
    if (mode !== "floating") return;
    e.preventDefault();
    e.stopPropagation();

    resizeRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: floatingSize.width,
      startHeight: floatingSize.height,
    };
    setIsResizing(handle);
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!resizeRef.current) return;
      const { handle, startX, startY, startWidth, startHeight } = resizeRef.current;
      const maxW = Math.max(MIN_FLOATING_WIDTH, window.innerWidth - 48);
      const maxH = Math.max(MIN_FLOATING_HEIGHT, window.innerHeight - 48);

      let newWidth = startWidth;
      let newHeight = startHeight;

      // Anchored at bottom: 24px, right: 24px
      // Moving mouse to the left (smaller X) increases card width
      if (handle === "w" || handle === "nw") {
        const deltaX = startX - e.clientX;
        newWidth = Math.min(maxW, Math.max(MIN_FLOATING_WIDTH, startWidth + deltaX));
      }

      // Moving mouse upward (smaller Y) increases card height
      if (handle === "n" || handle === "nw") {
        const deltaY = startY - e.clientY;
        newHeight = Math.min(maxH, Math.max(MIN_FLOATING_HEIGHT, startHeight + deltaY));
      }

      setFloatingSize({ width: Math.round(newWidth), height: Math.round(newHeight) });
    };

    const handlePointerUp = () => {
      setIsResizing(null);
      document.body.style.userSelect = "";
      if (resizeRef.current) {
        setFloatingSize((latest) => {
          try {
            localStorage.setItem("tars_copilot_floating_size", JSON.stringify(latest));
          } catch {}
          return latest;
        });
      }
      resizeRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const resetFloatingSize = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const defaultSize = { width: DEFAULT_FLOATING_WIDTH, height: DEFAULT_FLOATING_HEIGHT };
    setFloatingSize(defaultSize);
    try {
      localStorage.setItem("tars_copilot_floating_size", JSON.stringify(defaultSize));
    } catch {}
  };

  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        if (mode === "fullscreen") {
          e.preventDefault();
          toggleSidebar();
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [mode]);

  // Animate Braille CLI spinner when busy (Claude Code / Codex aesthetic)
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      setSpinnerIndex((prev) => (prev + 1) % CLI_SPINNER_FRAMES.length);
    }, 85);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    try {
      localStorage.setItem(UNIFIED_STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  useEffect(() => {
    if (!conversationId || !effectiveSessionId || v2Context || messages.length > 0) return;
    api
      .copilotConversation(effectiveSessionId, conversationId)
      .then((result) => {
        if (result.messages && result.messages.length > 0) {
          setMessages(result.messages);
        }
      })
      .catch(() => {
        localStorage.removeItem(storageKey);
        setConversationId(null);
      });
  }, [conversationId, effectiveSessionId, storageKey, v2Context, messages.length]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinkingStatus, liveSteps]);

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

    if (
      n1.includes("gstr") ||
      n1.includes("gov") ||
      n1.includes("portal") ||
      n2.includes("pr") ||
      n2.includes("purchase")
    ) {
      return { gstr: f1, pr: f2 };
    }
    if (
      n2.includes("gstr") ||
      n2.includes("gov") ||
      n2.includes("portal") ||
      n1.includes("pr") ||
      n1.includes("purchase")
    ) {
      return { gstr: f2, pr: f1 };
    }
    return { gstr: f1, pr: f2 };
  };

  const ask = async (message: string) => {
    const finalMessage = message.trim() || (attachedFiles.length > 0 ? "reconcile" : "");
    if (!finalMessage || busy) return;

    const startTime = Date.now();
    setBusy(true);
    setError(null);
    setThinkingStatus("Processing instruction…");
    setLiveSteps([]);

    const currentContext: CopilotMessageContext = {
      sessionId: v2Context?.sessionId || effectiveSessionId || null,
      sessionTitle: v2Context?.gstrFilename
        ? `${v2Context.gstrFilename} vs ${v2Context.prFilename || "PR"}`
        : null,
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
      content:
        attachedFiles.length > 0
          ? `${finalMessage} (Attached: ${attachedFiles.map((f) => f.name).join(", ")})`
          : finalMessage,
      selected_record_id: selectedRecordId,
      response: null,
      created_at: new Date().toISOString(),
      context: currentContext,
    };
    const nextMessages = [...messages, optimistic];
    setMessages(nextMessages);
    setDraft("");

    const isV2 = Boolean(v2Context || (currentPage && currentPage.includes("reconciliations-v2")) || (currentPage && currentPage.includes("audit-v2")));

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
        telemetry_steps: [],
      };
      setMessages([...nextMessages, initialAssistantMsg]);

      const hadAttachments = attachedFiles.length > 0;
      const startTime = Date.now();
      let accumulatedContent = "";
      let accumulatedThought = "";
      const collectedSteps: CopilotTelemetryStep[] = [];
      setLiveThought("");

      try {
        let res: Response;

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
          const historyPayload = nextMessages.slice(-10).map((m) => ({
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
                setMessages((current) =>
                  current.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: accumulatedContent, thought_content: accumulatedThought }
                      : m
                  )
                );
              } else if (data.type === "thought_content") {
                accumulatedThought += data.delta || data.content || "";
                setLiveThought(accumulatedThought);
                setMessages((current) =>
                  current.map((m) =>
                    m.id === assistantId ? { ...m, thought_content: accumulatedThought } : m
                  )
                );
              } else if (data.type === "thought") {
                setThinkingStatus(data.message);
              } else if (data.type === "thought_step") {
                const newStep: CopilotTelemetryStep = {
                  id: data.step_id || crypto.randomUUID(),
                  label: data.label,
                  duration_ms: data.duration_ms,
                  status: data.status || "completed",
                };
                collectedSteps.push(newStep);
                setLiveSteps([...collectedSteps]);
                setMessages((current) =>
                  current.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          telemetry_steps: [...collectedSteps],
                          thought_content: accumulatedThought,
                        }
                      : m
                  )
                );
              } else if (data.type === "action") {
                copilotV2Bridge.dispatchAction({
                  action: data.action,
                  payload: data.payload,
                  status: data.status,
                });
              } else if (data.type === "done") {
                const totalDuration = Date.now() - startTime;
                setThinkingStatus(null);
                setLiveThought("");
                setMessages((current) =>
                  current.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          thought_content: accumulatedThought,
                          telemetry_steps: [...collectedSteps],
                          reasoning_duration_ms: totalDuration,
                        }
                      : m
                  )
                );
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
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      accumulatedContent ||
                      "❌ **Reconciliation Interrupted**: Could not complete stream processing. Please check server logs or workbook format.",
                    thought_content: accumulatedThought || undefined,
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
            nextMessages.slice(-6).map((m) => ({ role: m.role, content: m.content }))
          );
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantId ? { ...m, content: response.answer, response } : m
            )
          );
        } catch (fbErr) {
          setError(fbErr instanceof Error ? fbErr.message : "Copilot could not complete the request.");
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      "Could not retrieve response from Copilot server. Please verify backend service connectivity.",
                  }
                : m
            )
          );
        }
      } finally {
        setBusy(false);
        setThinkingStatus(null);
        setLiveSteps([]);
      }
      return;
    }

    // Standard V1 fallback
    try {
      const historyPayload = nextMessages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const response = await api.askCopilot(
        reconciliationId,
        finalMessage,
        conversationId ?? undefined,
        selectedRecordId ?? undefined,
        currentPage,
        historyPayload
      );
      if (!conversationId) {
        setConversationId(response.conversation_id);
        localStorage.setItem(storageKey, response.conversation_id);
      }
      setMessages((current) => [
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
        },
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Copilot could not complete the request.");
    } finally {
      setBusy(false);
      setThinkingStatus(null);
      setLiveSteps([]);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(draft);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setThinkingStatus(null);
    setLiveSteps([]);
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
          "Go forward to rules",
        ];
      }
      if (v2Context.activeStage === "rules") {
        return [
          "Should I select this rule?",
          "Add rule regarding invoice date within 30 days",
          "Ignore rule R-04",
          "Go forward to results",
        ];
      }
      if (v2Context.activeStage === "results") {
        return [
          "Why is this record near match rather than tolerance?",
          "How many records are unresolved?",
          "Go forward to summary",
        ];
      }
      if (v2Context.activeStage === "summary" || v2Context.activeStage === "export") {
        return ["What is the total claimable ITC?", "How do I export results?", "Go back to rules"];
      }
      if (v2Context.activeStage === "audit") {
        return [
          "Verify mathematical conservation across this audit",
          "Explain the actor breakdown between HUMAN and AI_COPILOT",
          "Are there any failed steps in this session run?",
        ];
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
    return reconciliationId ? "Grounded assistant" : "Global intelligence";
  };

  const getPlaceholder = () => {
    if (attachedFiles.length > 0) {
      return "Press Enter or type 'reconcile' to run autonomous pre-flight & matching passes…";
    }
    if (selectedRecordId) return `Ask about record ${selectedRecordId}…`;
    if (v2Context) {
      return `Ask about ${v2Context.stageLabel} (or 'map X to Y', 'add rule...', 'reconcile')…`;
    }
    if (reconciliationId) return "Ask about this reconciliation…";
    return "Ask TARS Copilot (press Enter to send)…";
  };

  return (
    <aside
      className={`tars-copilot-container mode-${mode} theme-${theme} ${isResizing ? "is-resizing" : ""}`}
      style={
        mode === "floating"
          ? {
              width: `${floatingSize.width}px`,
              height: `${floatingSize.height}px`,
            }
          : undefined
      }
      aria-labelledby="copilot-title"
    >
      {/* Interactive Resize Handles (Floating Card Mode only) */}
      {mode === "floating" && (
        <>
          {/* Top-Left Diagonal Corner Grip Handle */}
          <div
            className="tars-copilot-resize-handle tars-copilot-resize-nw"
            onPointerDown={(e) => startResize(e, "nw")}
            onDoubleClick={resetFloatingSize}
            title="Drag to resize width & height (Double-click to reset default size)"
            aria-label="Resize window diagonally"
          >
            <div className="tars-copilot-resize-corner-grip" />
          </div>

          {/* Top Edge Handle */}
          <div
            className="tars-copilot-resize-handle tars-copilot-resize-n"
            onPointerDown={(e) => startResize(e, "n")}
            title="Drag to resize height"
            aria-label="Resize window vertically"
          />

          {/* Left Edge Handle */}
          <div
            className="tars-copilot-resize-handle tars-copilot-resize-w"
            onPointerDown={(e) => startResize(e, "w")}
            title="Drag to resize width"
            aria-label="Resize window horizontally"
          />
        </>
      )}

      {/* 1. Header Toolbar */}
      <header className="tars-copilot-header">
        <div className="tars-copilot-header-brand">
          {mode === "fullscreen" && (
            <button
              type="button"
              className={`tars-copilot-icon-btn tars-copilot-sidebar-toggle-btn ${sidebarCollapsed ? "is-collapsed" : ""}`}
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Expand Session Telemetry (Ctrl+B)" : "Collapse Session Telemetry (Ctrl+B)"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          )}

          <div className="tars-copilot-brand-icon">
            <Sparkles size={16} />
          </div>
          <div>
            <h2 id="copilot-title" className="tars-copilot-header-title">
              TARS Copilot
            </h2>
          </div>
          <span className={`tars-copilot-header-status ${busy ? "is-thinking" : ""}`}>
            {busy ? (
              <>
                <span className="tars-copilot-cli-spinner">{CLI_SPINNER_FRAMES[spinnerIndex]}</span>
                <span>THINKING</span>
              </>
            ) : (
              <>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                <span>ONLINE</span>
              </>
            )}
          </span>
        </div>

        <div className="tars-copilot-header-actions">
          {/* Light Mode (KPMG Cloud #f7f9fa) vs Dark Mode (KPMG Midnight #070e17) Toggle */}
          <button
            type="button"
            className="tars-copilot-icon-btn tars-copilot-btn-theme"
            onClick={toggleTheme}
            title={theme === "light" ? "Switch to Dark Mode (KPMG Midnight Navy)" : "Switch to Light Mode (KPMG Cloud)"}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              className="tars-copilot-icon-btn tars-copilot-btn-clear"
              onClick={clearChat}
              title="Clear conversation history"
              aria-label="Clear chat"
            >
              <Trash2 size={16} />
            </button>
          )}

          {mode !== "fullscreen" && onModeChange && (
            <button
              type="button"
              className="tars-copilot-icon-btn tars-copilot-btn-maximize"
              onClick={() => onModeChange("fullscreen")}
              title="Maximize to Fullscreen Console Workstation"
              aria-label="Maximize"
            >
              <Maximize2 size={16} />
            </button>
          )}

          {mode === "fullscreen" && onModeChange && (
            <button
              type="button"
              className="tars-copilot-icon-btn tars-copilot-btn-restore"
              onClick={() => onModeChange("floating")}
              title="Restore to Floating Window"
              aria-label="Restore"
            >
              <Minimize2 size={16} />
            </button>
          )}

          {onClose && (
            <button
              type="button"
              className="tars-copilot-icon-btn tars-copilot-btn-close"
              onClick={onClose}
              title="Close Copilot (Ctrl+K)"
              aria-label="Close"
            >
              <X size={17} />
            </button>
          )}
        </div>
      </header>

      {/* 2. Context & Stage Telemetry Bar */}
      <div className="tars-copilot-context-bar">
        <span className="tars-copilot-stage-badge">
          <Terminal size={12} style={{ color: "var(--kpmg-atlantic, #0091da)" }} />
          <span>LOCATION:</span>
          <strong>{v2Context?.stageLabel || (effectiveSessionId ? "RECONCILIATION SESSION" : "GLOBAL WORKBENCH")}</strong>
        </span>

        {v2Context?.sessionId && (
          <span style={{ fontSize: 10, color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
            ID: {v2Context.sessionId.slice(0, 8)}…
          </span>
        )}
      </div>

      {/* 3. Main Body Container (Supports 2-Column in Fullscreen Mode) */}
      <div className={`tars-copilot-body ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
        {/* Fullscreen Telemetry Sidebar */}
        {!sidebarCollapsed && (
          <aside className="tars-copilot-telemetry-sidebar">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#f8fafc" }}>
                <Cpu size={15} style={{ color: "var(--kpmg-atlantic, #0091da)" }} />
                <span>SESSION RUNTIME TELEMETRY</span>
              </div>
              <button
                type="button"
                className="tars-copilot-icon-btn tars-copilot-sidebar-collapse-btn"
                onClick={toggleSidebar}
                title="Collapse Telemetry Sidebar (Ctrl+B)"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>

            <div style={{ background: "rgba(13, 26, 45, 0.7)", border: "1px solid rgba(0, 145, 218, 0.15)", borderRadius: 8, padding: 12, fontSize: 11 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4, fontWeight: 600 }}>Active Screen</div>
              <div style={{ color: "var(--kpmg-glacier, #72cdf4)", fontWeight: 700 }}>{v2Context?.stageLabel || "Global Flight Deck"}</div>
            </div>

            {v2Context?.gstrFilename && (
              <div style={{ background: "rgba(13, 26, 45, 0.7)", border: "1px solid rgba(0, 145, 218, 0.15)", borderRadius: 8, padding: 12, fontSize: 11 }}>
                <div style={{ color: "#94a3b8", marginBottom: 6, fontWeight: 600 }}>Workbooks Linked</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#e2e8f0" }}>
                    <FileSpreadsheet size={13} style={{ color: "var(--kpmg-atlantic, #0091da)" }} />
                    <span style={{ maxWidth: 260, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                      GSTR: {v2Context.gstrFilename}
                    </span>
                  </div>
                  {v2Context.prFilename && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#e2e8f0" }}>
                      <FileSpreadsheet size={13} style={{ color: "var(--kpmg-atlantic, #0091da)" }} />
                      <span style={{ maxWidth: 260, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                        PR: {v2Context.prFilename}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {v2Context?.resultsSummary && (
              <div style={{ background: "rgba(13, 26, 45, 0.7)", border: "1px solid rgba(0, 145, 218, 0.15)", borderRadius: 8, padding: 12, fontSize: 11 }}>
                <div style={{ color: "#94a3b8", marginBottom: 6, fontWeight: 600 }}>Classification Matrix</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ color: "#10b981", fontWeight: 700, fontSize: 14 }}>
                      {v2Context.resultsSummary.exact.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>Exact Matches</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--kpmg-atlantic, #0091da)", fontWeight: 700, fontSize: 14 }}>
                      {v2Context.resultsSummary.tolerance.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>Tolerance</div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: "auto", padding: 12, background: "rgba(0, 51, 141, 0.15)", borderRadius: 8, border: "1px solid rgba(0, 145, 218, 0.25)", fontSize: 11, color: "var(--kpmg-glacier, #72cdf4)" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Agentic Command Engine</div>
              <div>All responses are calculated against persisted financial truth with sub-second execution.</div>
            </div>
          </aside>
        )}

        {/* Conversation Stream */}
        <div className="tars-copilot-chat-container">
          <div className="tars-copilot-messages" ref={logRef}>
            {messages.length === 0 && (
              <div className="tars-copilot-empty-state">
                <div className="tars-copilot-empty-title">
                  <Sparkles size={18} style={{ color: "var(--kpmg-atlantic, #0091da)" }} />
                  <span>Welcome to TARS Copilot</span>
                </div>
                <p className="tars-copilot-empty-desc">
                  {v2Context
                    ? `I am actively monitoring ${v2Context.stageLabel}. You can ask questions, verify variance tolerances, or issue direct operational commands like "map X to Y", "add rule...", or "reconcile".`
                    : "Your grounded agentic partner for GST reconciliation, statutory tax compliance, and multi-workbook ledger matching."}
                </p>

                <div className="tars-copilot-prompt-pills">
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Suggested Actions
                  </div>
                  {samplePrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="tars-copilot-prompt-btn"
                      onClick={() => void ask(prompt)}
                    >
                      <span>{prompt}</span>
                      <ArrowRight size={13} style={{ color: "var(--kpmg-atlantic, #0091da)" }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, idx) => {
              const isUser = message.role === "user";
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
                    <div className="tars-copilot-switch-banner session-switched">
                      <span>
                        🔄 Session Changed: {prevCtx?.sessionId?.slice(0, 8)} ➔ {currCtx?.sessionId?.slice(0, 8)}
                      </span>
                    </div>
                  )}

                  {stageSwitched && (
                    <div className="tars-copilot-switch-banner stage-switched">
                      <span>
                        🧭 Stage Switched: {prevCtx?.stageLabel || prevCtx?.stageKey} ➔ {currCtx?.stageLabel || currCtx?.stageKey}
                      </span>
                    </div>
                  )}

                  <article className={`tars-msg ${isUser ? "is-user" : "is-assistant"}`}>
                    <div className="tars-msg-header">
                      <span className={`tars-msg-author ${isUser ? "" : "is-copilot"}`}>
                        {!isUser && <Sparkles size={12} />}
                        {isUser ? "You" : "TARS Copilot"}
                      </span>
                      {currCtx && (currCtx.stageLabel || currCtx.sessionId) && (
                        <span className="tars-msg-badge">
                          {currCtx.stageLabel || (currCtx.sessionId ? `Sess: ${currCtx.sessionId.slice(0, 6)}` : "Global")}
                        </span>
                      )}
                    </div>

                    {/* Post-Completion Collapsible Thought Accordion (Claude Code Style) */}
                    {!isUser && ((message.thought_content && message.thought_content.trim().length > 0) || (message.telemetry_steps && message.telemetry_steps.length > 0)) && (
                      <ThoughtAccordion
                        thoughtContent={message.thought_content}
                        steps={message.telemetry_steps}
                        durationMs={message.reasoning_duration_ms}
                      />
                    )}

                    <div className="tars-msg-bubble">
                      {renderFormattedContent(message.content)}
                    </div>

                    {message.response && (
                      <>
                        {message.response.evidence.length > 0 && (
                          <details style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
                            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                              View evidence ({message.response.evidence.length} facts)
                            </summary>
                            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                              {message.response.evidence.map((item) => (
                                <div
                                  key={`${item.reference_type}-${item.reference_id}`}
                                  style={{ padding: "4px 8px", background: "rgba(255, 255, 255, 0.04)", borderRadius: 4 }}
                                >
                                  <strong>{item.reference_type.replaceAll("_", " ")}</strong>: {item.reference_id}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </article>
                </React.Fragment>
              );
            })}

            {/* Live Sub-Second Telemetry Trace during generation */}
            {busy && (
              <div className="tars-copilot-telemetry-live">
                <div className="tars-copilot-telemetry-header">
                  <span className="tars-copilot-cli-spinner">{CLI_SPINNER_FRAMES[spinnerIndex]}</span>
                  <span>{thinkingStatus || (liveThought ? "Cognitive Reasoning..." : "Thinking...")}</span>
                </div>
                {liveThought && (
                  <div className="tars-copilot-live-thought-preview">
                    {liveThought.slice(-180)}
                    <span className="tars-copilot-typing-cursor">▌</span>
                  </div>
                )}
                {liveSteps.length > 0 && (
                  <div className="tars-copilot-telemetry-steps">
                    {liveSteps.map((step) => (
                      <div key={step.id} className="tars-copilot-telemetry-line">
                        <span className="step-glyph">›</span>
                        <span className="step-label">{step.label}</span>
                        {step.duration_ms && <span className="step-ms">[{step.duration_ms}ms]</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div style={{ margin: "0 16px 8px 16px", padding: "8px 12px", background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 6, color: "#fca5a5", fontSize: 12 }}>
              {error}
            </div>
          )}

          {/* 4. Sleek Input Bar (ChatGPT / Codex Aesthetic) */}
          <footer className="tars-copilot-footer">
            <form onSubmit={submit}>
              <div className="tars-copilot-input-box">
                {/* Attached Workbooks Chips */}
                {attachedFiles.length > 0 && (
                  <div className="tars-copilot-attached-chips">
                    {attachedFiles.map((f, i) => {
                      const isGstr =
                        f.name.toLowerCase().includes("gstr") ||
                        f.name.toLowerCase().includes("gov") ||
                        i === 0;
                      return (
                        <div key={i} className="tars-copilot-chip">
                          <FileSpreadsheet size={13} style={{ color: "var(--kpmg-glacier, #72cdf4)" }} />
                          <span style={{ fontWeight: 700, color: "var(--kpmg-glacier, #72cdf4)" }}>
                            {isGstr && attachedFiles.length > 1 ? "GSTR-2B:" : "PR:"}
                          </span>
                          <span style={{ maxWidth: 120, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                            {f.name}
                          </span>
                          <button type="button" onClick={() => removeFile(i)}>
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  className="tars-copilot-textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={getPlaceholder()}
                  rows={2}
                  disabled={busy}
                />

                <div className="tars-copilot-input-toolbar">
                  <div className="tars-copilot-input-actions-left">
                    <button
                      type="button"
                      className={`tars-copilot-attach-btn ${attachedFiles.length > 0 ? "has-files" : ""}`}
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach Excel workbooks (GSTR-2B or Purchase Register)"
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

                  <button
                    type="submit"
                    className="tars-copilot-send-btn"
                    disabled={busy || (!draft.trim() && attachedFiles.length === 0)}
                    title="Send message (Enter)"
                    aria-label="Send"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </form>
          </footer>
        </div>
      </div>
    </aside>
  );
}
