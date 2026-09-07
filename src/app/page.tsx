"use client";

import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "assistant"; content: string };
const promptGroups = [
  { label: "Create", icon: "✦", prompt: "Turn my rough idea into something clear, original, and ready to share" },
  { label: "Learn", icon: "◒", prompt: "Teach me a difficult topic from first principles, with a simple example" },
  { label: "Plan", icon: "⌁", prompt: "Help me make a practical plan for a meaningful goal this month" },
  { label: "Solve", icon: "◇", prompt: "Help me think through a messy problem and choose the best next step" },
];
const prompts = ["Draft a thoughtful email", "Break down a complex topic", "Plan my week", "Brainstorm fresh ideas"];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("Gemini 3.6 Flash");
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  async function send(event?: FormEvent, value = input) {
    event?.preventDefault();
    const text = value.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages([...next, { role: "assistant", content: "" }]); setInput(""); setLoading(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next, model }) });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Gemini could not complete that request.");
      }
      if (!response.body) throw new Error("The response stream was unavailable. Please try again.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedContent = "";
      let pendingText = "";
      let animating = false;
      let streamDone = false;
      let resolveDrain: (() => void) | null = null;
      const pumpText = () => {
        if (!pendingText) {
          animating = false;
          if (streamDone) resolveDrain?.();
          return;
        }
        animating = true;
        const lineBreak = pendingText.indexOf("\n");
        const amount = lineBreak >= 0 ? lineBreak + 1 : Math.min(4, pendingText.length);
        streamedContent += pendingText.slice(0, amount);
        pendingText = pendingText.slice(amount);
        setMessages([...next, { role: "assistant", content: streamedContent }]);
        window.setTimeout(pumpText, lineBreak >= 0 ? 150 : 32);
      };
      const queueText = (text: string) => {
        pendingText += text;
        if (!animating) pumpText();
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
        const events = buffer.split("\n\n");
        buffer = done ? "" : events.pop() || "";
        for (const event of events) {
          const line = event.split("\n").find((item) => item.startsWith("data:"));
          if (!line) continue;
          const chunk = JSON.parse(line.slice(5).trim()) as string;
          queueText(chunk);
        }
        if (done) break;
      }
      streamDone = true;
      if (pendingText) await new Promise<void>((resolve) => { resolveDrain = resolve; });
      if (!streamedContent) setMessages([...next, { role: "assistant", content: "I couldn’t generate a response for that." }]);
    } catch (error) {
      setMessages([...next, { role: "assistant", content: error instanceof Error ? error.message : "Unable to reach Gemini right now." }]);
    } finally { setLoading(false); }
  }

  function reset() { setMessages([]); setInput(""); setMenuOpen(false); }

  async function copyMessage(content: string, index: number) {
    await navigator.clipboard.writeText(content);
    setCopied(index);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <button className="brand" onClick={reset}><b>✦</b> lumina <span>AI workspace</span></button>
        <button className="close" onClick={() => setMenuOpen(false)} aria-label="Close sidebar">×</button>
        <button className="new-chat" onClick={reset}>＋ New conversation <kbd>⌘ K</kbd></button>
        <p className="section-label">Your space <span>•••</span></p>
        <nav className="history"><button className="history-item active">◌ <span>New conversation</span><b>now</b></button><button className="history-item">◌ <span>Ideas for a better morning</span></button><button className="history-item">◌ <span>Understanding black holes</span></button><button className="history-item">◌ <span>Notes on a new beginning</span></button></nav>
        <div className="sidebar-bottom"><div className="capability-note"><strong>Built for the whole day</strong><span>Write, learn, plan, solve, and create in one calm workspace.</span></div><button className="side-link">⌁ &nbsp; Explore models</button><button className="side-link">⚙ &nbsp; Settings</button><div className="account"><i>A</i><span><strong>Alex Morgan</strong><small>Personal workspace</small></span><b>•••</b></div></div>
      </aside>
      <section className="chat-area">
        <header className="topbar"><button className="menu" onClick={() => setMenuOpen(true)} aria-label="Open sidebar">☰</button><label><i /> <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Select model"><option>Gemini 3.6 Flash</option><option>Gemini 3.6 Pro</option></select><span className="model-caret">⌄</span></label><div className="top-actions"><button aria-label="Search">⌕</button><button className="share" onClick={() => navigator.clipboard.writeText(window.location.href)}>↗ <span>Share</span></button></div></header>
        <div className="conversation">
          {!messages.length ? <div className="welcome"><div className="welcome-mark">✦</div><p className="eyebrow">Your capable thinking partner</p><h1>What can we<br /><em>make easier?</em></h1><p className="welcome-copy">A thoughtful AI for the questions, projects, and decisions that fill your day.</p><div className="capability-grid">{promptGroups.map((group) => <button className="capability" key={group.label} onClick={() => send(undefined, group.prompt)}><span className="capability-icon">{group.icon}</span><span><strong>{group.label}</strong><small>{group.prompt}</small></span><b>↗</b></button>)}</div><div className="prompt-strip"><span>Try asking</span>{prompts.map((prompt) => <button key={prompt} onClick={() => send(undefined, prompt)}>{prompt}</button>)}</div></div> : <div className="messages">{messages.map((message, index) => { const streaming = loading && index === messages.length - 1 && message.role === "assistant"; return <article className={`message ${streaming ? "streaming" : ""}`} key={`${message.role}-${index}`}><i className={message.role}>{message.role === "user" ? "A" : "✦"}</i><div className="message-body"><div className="message-meta"><small>{message.role === "user" ? "You" : "Lumina"}</small>{message.role === "assistant" && <button className="copy" onClick={() => copyMessage(message.content, index)}>{copied === index ? "Copied" : "Copy"}</button>}</div>{message.role === "assistant" ? <div className="markdown">{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <p className="typing">● ● ●</p>}{streaming && <span className="stream-cursor" />}</div> : <p>{message.content}</p>}</div></article>; })}</div>}
        </div>
        <div className="composer-wrap"><form className="composer" onSubmit={send}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask Lumina anything..." rows={1} aria-label="Message Lumina" /><div><button type="button" className="attach" aria-label="Add context">＋ Add context</button><span>↵ to send · ⇧↵ for new line</span><button className="send" type="submit" disabled={!input.trim() || loading} aria-label="Send message">↑</button></div></form><p className="disclaimer">Lumina can make mistakes. Check important information.</p></div>
      </section>
    </main>
  );
}
