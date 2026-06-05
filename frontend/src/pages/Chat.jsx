import { useState, useEffect, useRef, useCallback } from "react";
import { sendChatMessage, getChatUsage } from "../api/client";
import { Bot, Send, RotateCcw, Loader2, MessageSquare, AlertCircle } from "lucide-react";

const SUGGESTIONS = [
  "Qual meu patrimônio total hoje?",
  "Quais títulos vencem nos próximos 30 dias?",
  "Estou muito concentrado em algum ativo?",
  "Quanto vou receber de juros esse ano?",
  "Compare minha rentabilidade com o CDI",
  "Analise meu risco cambial",
];

// ── Minimal markdown renderer ─────────────────────────────────────────────────
function renderContent(text) {
  return text.split("\n").map((line, i) => {
    const bold = line.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
    return (
      <span key={i}>
        <span dangerouslySetInnerHTML={{ __html: bold }} />
        {i < text.split("\n").length - 1 && <br />}
      </span>
    );
  });
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function Bubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
          style={{ background: "linear-gradient(135deg,#7C3AED,#4F46E5)" }}
        >
          <Bot size={14} className="text-white" />
        </div>
      )}
      <div
        className="max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
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

function ErrorBubble({ content }) {
  return (
    <div className="flex justify-center mb-3">
      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-600 max-w-md">
        <AlertCircle size={14} className="flex-shrink-0" />
        <span>{content}</span>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
        style={{ background: "linear-gradient(135deg,#7C3AED,#4F46E5)" }}
      >
        <Bot size={14} className="text-white" />
      </div>
      <div
        className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-2.5"
        style={{ borderBottomLeftRadius: 4 }}
      >
        <Loader2 size={14} className="text-indigo-500 animate-spin" />
        <span className="text-sm text-gray-400">Analisando seu portfólio…</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [usage,    setUsage]    = useState(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    getChatUsage().then((r) => setUsage(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");

    const userMsg    = { role: "user", content: msg };
    const nextMsgs   = [...messages, userMsg];
    setMessages(nextMsgs);
    setLoading(true);

    // Build history for API (exclude current user message — it goes in body.message)
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const r = await sendChatMessage(msg, history);
      const { response, messages_used, messages_limit } = r.data;
      setMessages([...nextMsgs, { role: "assistant", content: response }]);
      setUsage((u) =>
        u ? { ...u, messages_used, messages_limit } : { messages_used, messages_limit, days_until_reset: 0 }
      );
    } catch (err) {
      const detail = err?.response?.data?.detail || "Erro ao conectar com a IA. Verifique se o backend está rodando.";
      setMessages([...nextMsgs, { role: "error", content: detail }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [input, messages, loading]);

  const reset = () => { setMessages([]); setInput(""); };

  const isAtLimit = usage && usage.messages_used >= usage.messages_limit;
  const usedPct   = usage ? Math.round((usage.messages_used / usage.messages_limit) * 100) : 0;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div
        className="flex-shrink-0 -mx-4 md:-mx-6 px-4 md:px-6 py-4 flex items-center justify-between"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-800">Assistente IA</h2>
          <p className="text-gray-400 text-sm">Seu portfólio, explicado pela IA</p>
        </div>
        {messages.length > 0 && (
          <button onClick={reset} className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5">
            <RotateCcw size={12} /> Nova conversa
          </button>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto py-5 px-1 md:px-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
            {/* Logo */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg,#7C3AED,#4F46E5)" }}
            >
              <Bot size={32} className="text-white" />
            </div>
            <div className="text-center max-w-sm">
              <p className="text-gray-800 font-semibold text-lg">Olá! Sou o assistente do PatrimonIA</p>
              <p className="text-gray-400 text-sm mt-1">
                Tenho acesso completo ao seu portfólio e posso responder perguntas sobre seus investimentos, vencimentos, risco e rentabilidade.
              </p>
            </div>
            {/* Suggestion chips */}
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={isAtLimit || loading}
                  className="text-sm px-4 py-2 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    borderColor: "#c4b5fd",
                    color: "#6D28D9",
                    background: "#faf5ff",
                  }}
                  onMouseEnter={(e) => { if (!isAtLimit) e.currentTarget.style.background = "#ede9fe"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#faf5ff"; }}
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
                <ErrorBubble key={i} content={msg.content} />
              ) : (
                <Bubble key={i} role={msg.role} content={msg.content} />
              )
            )}
            {loading && <TypingIndicator />}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="flex-shrink-0 border-t border-gray-100 bg-white px-4 py-3"
      >
        {isAtLimit ? (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-red-600">
              Limite mensal atingido ({usage.messages_used}/{usage.messages_limit} mensagens).
            </p>
            <p className="text-xs text-red-400 mt-0.5">
              Renova em {usage.days_until_reset} dias.
            </p>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none transition-shadow"
              style={{ minHeight: 42, maxHeight: 120 }}
              placeholder="Pergunte sobre seu portfólio… (Enter para enviar)"
              value={input}
              disabled={loading}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onFocus={(e) => { e.target.style.boxShadow = "0 0 0 3px rgba(124,58,237,0.15)"; e.target.style.borderColor = "#a78bfa"; }}
              onBlur={(e)  => { e.target.style.boxShadow = "none"; e.target.style.borderColor = "#e5e7eb"; }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", color: "#fff" }}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        )}

        {/* Usage bar */}
        {usage && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(usedPct, 100)}%`,
                  background: usedPct >= 90 ? "#dc2626" : usedPct >= 70 ? "#f59e0b" : "#7C3AED",
                }}
              />
            </div>
            <span className="text-xs text-gray-300 flex-shrink-0 flex items-center gap-1">
              <MessageSquare size={10} />
              {usage.messages_used}/{usage.messages_limit}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
