"use client";

import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "assistant"; content: string };
type Conversation = { id: string; title: string; messages: Message[]; updatedAt: number };
const conversationsKey = "lumina-conversations";
const promptGroups = [
  { label: "Create", icon: "✦", prompt: "Turn my rough idea into something clear, original, and ready to share" },
  { label: "Learn", icon: "◒", prompt: "Teach me a difficult topic from first principles, with a simple example" },
  { label: "Plan", icon: "⌁", prompt: "Help me make a practical plan for a meaningful goal this month" },
  { label: "Solve", icon: "◇", prompt: "Help me think through a messy problem and choose the best next step" },
];
const prompts = ["Draft a thoughtful email", "Break down a complex topic", "Plan my week", "Brainstorm fresh ideas"];

function readSavedConversations() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(conversationsKey) || "[]") as Conversation[];
  } catch {
    localStorage.removeItem(conversationsKey);
    return [];
  }
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>(readSavedConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => readSavedConversations()[0]?.id || null);
  const [messages, setMessages] = useState<Message[]>(() => readSavedConversations()[0]?.messages || []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  function saveConversation(id: string, nextMessages: Message[]) {
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === id);
      const updated = existing
        ? { ...existing, messages: nextMessages, updatedAt: Date.now() }
        : { id, title: nextMessages.find((message) => message.role === "user")?.content.slice(0, 42) || "Untitled conversation", messages: nextMessages, updatedAt: Date.now() };
      const next = [updated, ...current.filter((conversation) => conversation.id !== id)].slice(0, 30);
      localStorage.setItem(conversationsKey, JSON.stringify(next));
      return next;
    });
  }

  async function send(event?: FormEvent, value = input) {
    event?.preventDefault();
    const text = value.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    const conversationId = activeConversationId || crypto.randomUUID();
    setActiveConversationId(conversationId);
    const initialMessages = [...next, { role: "assistant" as const, content: "" }];
    setMessages(initialMessages); saveConversation(conversationId, initialMessages); setInput(""); setLoading(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
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
        const streamedMessages = [...next, { role: "assistant" as const, content: streamedContent }];
        setMessages(streamedMessages); saveConversation(conversationId, streamedMessages);
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
      if (!streamedContent) {
        const fallbackMessages = [...next, { role: "assistant" as const, content: "I couldn’t generate a response for that." }];
        setMessages(fallbackMessages); saveConversation(conversationId, fallbackMessages);
      }
    } catch (error) {
      const errorMessages = [...next, { role: "assistant" as const, content: error instanceof Error ? error.message : "Unable to reach Gemini right now." }];
      setMessages(errorMessages); saveConversation(conversationId, errorMessages);
    } finally { setLoading(false); }
  }

  function reset() { setMessages([]); setActiveConversationId(null); setInput(""); setMenuOpen(false); setSearchOpen(false); }

  function openConversation(conversation: Conversation) {
    if (loading) return;
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setSearchOpen(false);
    setMenuOpen(false);
  }

  const filteredConversations = conversations.filter((conversation) => {
    const haystack = `${conversation.title} ${conversation.messages.map((message) => message.content).join(" ")}`.toLowerCase();
    return haystack.includes(searchQuery.toLowerCase().trim());
  });

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
        <nav className="history"><button className={`history-item ${!activeConversationId ? "active" : ""}`} onClick={reset}>◌ <span>New conversation</span><b>{!activeConversationId ? "now" : ""}</b></button>{conversations.map((conversation) => <button className={`history-item ${conversation.id === activeConversationId ? "active" : ""}`} key={conversation.id} onClick={() => openConversation(conversation)}>◌ <span>{conversation.title || "Untitled conversation"}</span></button>)}</nav>
        <div className="sidebar-bottom"><div className="capability-note"><strong>Built for the whole day</strong><span>Write, learn, plan, solve, and create in one calm workspace.</span></div><button className="side-link">⌁ &nbsp; Explore models</button><button className="side-link">⚙ &nbsp; Settings</button><div className="account"><i>A</i><span><strong>Alex Morgan</strong><small>Personal workspace</small></span><b>•••</b></div></div>
      </aside>
      <section className="chat-area">
        <header className="topbar"><button className="menu" onClick={() => setMenuOpen(true)} aria-label="Open sidebar">☰</button><div className="workspace-status"><i /> <span>Lumina workspace</span></div><div className="top-actions"><button aria-label="Search conversations" onClick={() => setSearchOpen(true)}>⌕</button><button className="share" onClick={() => navigator.clipboard.writeText(window.location.href)}>↗ <span>Share</span></button></div></header>
        {searchOpen && <div className="search-panel"><div className="search-heading"><strong>Search conversations</strong><button onClick={() => setSearchOpen(false)} aria-label="Close search">×</button></div><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search your conversations..." aria-label="Search conversations" />{searchQuery && <div className="search-results">{filteredConversations.length ? filteredConversations.map((conversation) => <button key={conversation.id} onClick={() => openConversation(conversation)}><span>◌</span><span><strong>{conversation.title || "Untitled conversation"}</strong><small>{conversation.messages.length} messages</small></span></button>) : <p>No matching conversations</p>}</div>}</div>}
        <div className="conversation">
          {!messages.length ? <div className="welcome"><div className="welcome-mark">✦</div><p className="eyebrow">Your capable thinking partner</p><h1>What can we<br /><em>make easier?</em></h1><p className="welcome-copy">A thoughtful AI for the questions, projects, and decisions that fill your day.</p><div className="capability-grid">{promptGroups.map((group) => <button className="capability" key={group.label} onClick={() => send(undefined, group.prompt)}><span className="capability-icon">{group.icon}</span><span><strong>{group.label}</strong><small>{group.prompt}</small></span><b>↗</b></button>)}</div><div className="prompt-strip"><span>Try asking</span>{prompts.map((prompt) => <button key={prompt} onClick={() => send(undefined, prompt)}>{prompt}</button>)}</div></div> : <div className="messages">{messages.map((message, index) => { const streaming = loading && index === messages.length - 1 && message.role === "assistant"; return <article className={`message ${streaming ? "streaming" : ""}`} key={`${message.role}-${index}`}><i className={message.role}>{message.role === "user" ? "A" : "✦"}</i><div className="message-body"><div className="message-meta"><small>{message.role === "user" ? "You" : "Lumina"}</small>{message.role === "assistant" && <button className="copy" onClick={() => copyMessage(message.content, index)}>{copied === index ? "Copied" : "Copy"}</button>}</div>{message.role === "assistant" ? <div className="markdown">{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <p className="typing">● ● ●</p>}{streaming && <span className="stream-cursor" />}</div> : <p>{message.content}</p>}</div></article>; })}</div>}
        </div>
        <div className="composer-wrap"><form className="composer" onSubmit={send}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask Lumina anything..." rows={1} aria-label="Message Lumina" /><div><button type="button" className="attach" aria-label="Add context">＋ Add context</button><span>↵ to send · ⇧↵ for new line</span><button className="send" type="submit" disabled={!input.trim() || loading} aria-label="Send message">↑</button></div></form><p className="disclaimer">Lumina can make mistakes. Check important information.</p></div>
      </section>
    </main>
  );
}
