import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { sendChatMessage, getChatUsage } from "../api/client";
import { X, Send, Loader2, Maximize2, RotateCcw, AlertCircle } from "lucide-react";

const QUICK_SUGGESTIONS = [
  "Meu patrimônio hoje",
  "Títulos vencendo",
  "Análise de risco",
];

// ── Avatar SVG ─────────────────────────────────────────────────────────────────

function PatriAvatar({ size = 40 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Hair back layer */}
      <ellipse cx="20" cy="16" rx="13" ry="14" fill="#1E0A3C" />
      {/* Face */}
      <ellipse cx="20" cy="21" rx="10" ry="11" fill="#F9C784" />
      {/* Hair top / forehead */}
      <ellipse cx="20" cy="9" rx="11.5" ry="7" fill="#1E0A3C" />
      {/* Hair sides */}
      <path d="M 7 16 Q 6 24 9 30 Q 10 32 12 32 Q 9 28 9 23 Z" fill="#1E0A3C" />
      <path d="M 33 16 Q 34 24 31 30 Q 30 32 28 32 Q 31 28 31 23 Z" fill="#1E0A3C" />

      {/* Glasses — left */}
      <circle cx="15.5" cy="20" r="3.5" fill="rgba(255,255,255,0.12)" stroke="#C4B5FD" strokeWidth="1.3" />
      {/* Glasses — right */}
      <circle cx="24.5" cy="20" r="3.5" fill="rgba(255,255,255,0.12)" stroke="#C4B5FD" strokeWidth="1.3" />
      {/* Glasses bridge */}
      <line x1="19" y1="20" x2="21" y2="20" stroke="#C4B5FD" strokeWidth="1.3" />
      {/* Glasses arms */}
      <line x1="12" y1="19.5" x2="10.5" y2="19" stroke="#C4B5FD" strokeWidth="1.1" />
      <line x1="28" y1="19.5" x2="29.5" y2="19" stroke="#C4B5FD" strokeWidth="1.1" />

      {/* Pupils */}
      <circle cx="15.5" cy="20" r="1.4" fill="#2D1B69" />
      <circle cx="24.5" cy="20" r="1.4" fill="#2D1B69" />
      {/* Eye highlights */}
      <circle cx="14.9" cy="19.3" r="0.55" fill="white" />
      <circle cx="23.9" cy="19.3" r="0.55" fill="white" />

      {/* Eyebrows */}
      <path d="M 13 16 Q 15.5 14.8 18 16" stroke="#1E0A3C" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <path d="M 22 16 Q 24.5 14.8 27 16" stroke="#1E0A3C" strokeWidth="1.1" fill="none" strokeLinecap="round" />

      {/* Nose */}
      <path d="M 20 23 Q 18.5 25.5 19.5 26 Q 20.5 26 21.5 25.5 Q 22.5 24.8 20 23" fill="#E8A87C" />

      {/* Smile */}
      <path d="M 16.5 28.5 Q 20 31.5 23.5 28.5" stroke="#C47358" strokeWidth="1.3" fill="none" strokeLinecap="round" />

      {/* Neck */}
      <rect x="17.5" y="30" width="5" height="3" rx="1" fill="#F9C784" />

      {/* Shirt / collar */}
      <path d="M 7 40 Q 9 34 17 32 L 20 35.5 L 23 32 Q 31 34 33 40 Z" fill="#4C1D95" />
    </svg>
  );
}

// ── Message rendering ──────────────────────────────────────────────────────────

function renderContent(text) {
  return text.split("\n").map((line, i, arr) => {
    const html = line.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
    return (
      <span key={i}>
        <span dangerouslySetInnerHTML={{ __html: html }} />
        {i < arr.length - 1 && <br />}
      </span>
    );
  });
}

function Bubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2.5`}>
      {!isUser && (
        <div
          className="w-7 h-7 rounded-full flex-shrink-0 mr-2 mt-0.5 overflow-hidden"
          style={{ background: "linear-gradient(135deg,#4C1D95,#7C3AED)" }}
        >
          <PatriAvatar size={28} />
        </div>
      )}
      <div
        className="max-w-[82%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed"
        style={
          isUser
            ? {
                background: "linear-gradient(135deg,#7C3AED,#6D28D9)",
                color: "#fff",
                borderBottomRightRadius: 4,
              }
            : {
                background: "#fff",
                color: "#1f2937",
                border: "1px solid #e5e7eb",
                borderBottomLeftRadius: 4,
              }
        }
      >
        {renderContent(content)}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex justify-start mb-2.5">
      <div
        className="w-7 h-7 rounded-full flex-shrink-0 mr-2 mt-0.5 overflow-hidden"
        style={{ background: "linear-gradient(135deg,#4C1D95,#7C3AED)" }}
      >
        <PatriAvatar size={28} />
      </div>
      <div
        className="bg-white border border-gray-200 rounded-2xl px-3 py-2.5 flex items-center gap-1.5"
        style={{ borderBottomLeftRadius: 4 }}
      >
        <Loader2 size={12} className="text-indigo-500 animate-spin" />
        <span className="text-xs text-gray-400">Analisando…</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FloatingChat() {
  const navigate = useNavigate();

  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [usage,    setUsage]    = useState(null);
  const [unread,   setUnread]   = useState(0);
  const [hovered,  setHovered]  = useState(false);

  const panelRef      = useRef(null);
  const bottomRef     = useRef(null);
  const inputRef      = useRef(null);
  const seenCountRef  = useRef(0);

  useEffect(() => {
    getChatUsage().then((r) => setUsage(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Track unread AI messages when panel is closed
  useEffect(() => {
    if (!open && messages.length > seenCountRef.current) {
      const newSlice = messages.slice(seenCountRef.current);
      const newAI    = newSlice.filter((m) => m.role === "assistant").length;
      if (newAI > 0) setUnread((v) => v + newAI);
      seenCountRef.current = messages.length;
    }
  }, [messages, open]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
        seenCountRef.current = messages.length;
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, messages.length]);

  const handleToggle = () => {
    if (!open) {
      setUnread(0);
      seenCountRef.current = messages.length;
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 300);
    } else {
      setOpen(false);
      seenCountRef.current = messages.length;
    }
  };

  const handleExpand = () => {
    setOpen(false);
    navigate("/chat");
  };

  const send = useCallback(
    async (text) => {
      const msg = (text ?? input).trim();
      if (!msg || loading) return;
      setInput("");

      const userMsg  = { role: "user", content: msg };
      const nextMsgs = [...messages, userMsg];
      setMessages(nextMsgs);
      setLoading(true);
      seenCountRef.current = nextMsgs.length;

      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      try {
        const r = await sendChatMessage(msg, history);
        const { response, messages_used, messages_limit } = r.data;
        setMessages([...nextMsgs, { role: "assistant", content: response }]);
        setUsage((u) =>
          u
            ? { ...u, messages_used, messages_limit }
            : { messages_used, messages_limit, days_until_reset: 0 }
        );
      } catch (err) {
        const detail =
          err?.response?.data?.detail || "Erro ao conectar com a IA.";
        setMessages([...nextMsgs, { role: "error", content: detail }]);
      } finally {
        setLoading(false);
      }
    },
    [input, messages, loading]
  );

  const isAtLimit = usage && usage.messages_used >= usage.messages_limit;
  const usedPct   = usage ? (usage.messages_used / usage.messages_limit) * 100 : 0;

  return (
    <>
      <style>{`
        @keyframes patri-slide-up {
          from { opacity: 0; transform: translateY(14px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        .patri-panel {
          animation: patri-slide-up 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
      `}</style>

      {/* ── FLOATING PANEL ── */}
      {open && (
        <div
          ref={panelRef}
          className="patri-panel fixed flex flex-col rounded-2xl overflow-hidden"
          style={{
            bottom:    96,
            right:     16,
            width:     "min(380px, calc(100vw - 32px))",
            height:    "min(500px, calc(100vh - 120px))",
            zIndex:    44,
            background: "#f5f6fa",
            boxShadow:
              "0 20px 60px rgba(76,29,149,0.18), 0 8px 24px rgba(0,0,0,0.12)",
            border: "1px solid rgba(139,92,246,0.18)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0"
            style={{
              background: "linear-gradient(135deg,#4C1D95 0%,#7C3AED 100%)",
              color:      "white",
            }}
          >
            <div
              className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0"
              style={{
                background: "rgba(255,255,255,0.12)",
                border:     "2px solid rgba(255,255,255,0.25)",
              }}
            >
              <PatriAvatar size={36} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">Patri</p>
              <p className="text-[11px] opacity-70 leading-tight">
                Assistente PatrimonIA
              </p>
            </div>

            <button
              onClick={handleExpand}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title="Abrir página completa"
            >
              <Maximize2 size={13} />
            </button>

            {messages.length > 0 && (
              <button
                onClick={() => {
                  setMessages([]);
                  seenCountRef.current = 0;
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Nova conversa"
              >
                <RotateCcw size={13} />
              </button>
            )}

            <button
              onClick={() => {
                setOpen(false);
                seenCountRef.current = messages.length;
              }}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X size={13} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-3 py-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
                <div
                  className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0"
                  style={{
                    background: "linear-gradient(135deg,#4C1D95,#7C3AED)",
                  }}
                >
                  <PatriAvatar size={64} />
                </div>
                <div>
                  <p className="font-semibold text-gray-800 text-sm">
                    Olá! Sou a Patri
                  </p>
                  <p className="text-gray-400 text-xs mt-1 leading-relaxed">
                    Tenho acesso ao seu portfólio. Pergunte sobre investimentos,
                    vencimentos ou rentabilidade.
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full max-w-[260px]">
                  {QUICK_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={isAtLimit || loading}
                      className="w-full text-sm px-4 py-2.5 rounded-xl border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        borderColor: "#c4b5fd",
                        color:       "#6D28D9",
                        background:  "#faf5ff",
                      }}
                      onMouseEnter={(e) => {
                        if (!isAtLimit)
                          e.currentTarget.style.background = "#ede9fe";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#faf5ff";
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) =>
                  msg.role === "error" ? (
                    <div key={i} className="flex justify-center mb-2.5">
                      <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 max-w-[90%]">
                        <AlertCircle size={11} className="flex-shrink-0" />
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <Bubble key={i} role={msg.role} content={msg.content} />
                  )
                )}
                {loading && <TypingDots />}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex-shrink-0 px-3 py-2.5 bg-white"
            style={{ borderTop: "1px solid #f0f0f0" }}
          >
            {isAtLimit ? (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-center">
                <p className="text-xs font-semibold text-red-600">
                  Limite atingido ({usage.messages_used}/{usage.messages_limit})
                </p>
                <p className="text-[10px] text-red-400 mt-0.5">
                  Renova em {usage.days_until_reset} dias
                </p>
              </div>
            ) : (
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  rows={1}
                  className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none transition-shadow"
                  style={{ minHeight: 38, maxHeight: 96 }}
                  placeholder="Pergunte à Patri… (Enter)"
                  value={input}
                  disabled={loading}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height =
                      Math.min(e.target.scrollHeight, 96) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onFocus={(e) => {
                    e.target.style.boxShadow =
                      "0 0 0 3px rgba(124,58,237,0.15)";
                    e.target.style.borderColor = "#a78bfa";
                  }}
                  onBlur={(e) => {
                    e.target.style.boxShadow  = "none";
                    e.target.style.borderColor = "#e5e7eb";
                  }}
                />
                <button
                  onClick={() => send()}
                  disabled={!input.trim() || loading}
                  className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: "linear-gradient(135deg,#7C3AED,#6D28D9)",
                    color:      "#fff",
                  }}
                >
                  {loading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                </button>
              </div>
            )}

            {usage && !isAtLimit && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <div className="flex-1 h-0.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width:      `${Math.min(usedPct, 100)}%`,
                      background:
                        usedPct >= 90
                          ? "#dc2626"
                          : usedPct >= 70
                          ? "#f59e0b"
                          : "#7C3AED",
                    }}
                  />
                </div>
                <span className="text-[10px] text-gray-300">
                  {usage.messages_used}/{usage.messages_limit}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── FAB BUTTON ── */}
      <button
        onClick={handleToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="fixed flex items-center justify-center rounded-full transition-all duration-200"
        style={{
          bottom:    24,
          right:     24,
          width:     60,
          height:    60,
          zIndex:    45,
          background:
            "linear-gradient(135deg,#4C1D95 0%,#7C3AED 100%)",
          boxShadow: hovered
            ? "0 8px 32px rgba(124,58,237,0.55), 0 4px 12px rgba(0,0,0,0.2)"
            : "0 4px 20px rgba(124,58,237,0.4), 0 2px 8px rgba(0,0,0,0.15)",
          transform: hovered ? "scale(1.05)" : "scale(1)",
        }}
        title="Assistente PatrimonIA"
      >
        <PatriAvatar size={44} />

        {/* Unread badge */}
        {unread > 0 && (
          <span
            className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1"
            style={{
              background: "#dc2626",
              color:       "white",
              border:      "2px solid white",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
