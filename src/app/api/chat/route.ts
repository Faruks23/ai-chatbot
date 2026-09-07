import { NextResponse } from "next/server";

type ChatMessage = { role: "user" | "assistant"; content: string };

type RateLimitEntry = { count: number; resetAt: number };

const rateLimitStore = new Map<string, RateLimitEntry>();
const defaultLimit = 20;
const defaultWindowMs = 60_000;

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
}

function checkRateLimit(request: Request) {
  const configuredLimit = Number(process.env.CHAT_RATE_LIMIT);
  const configuredWindow = Number(process.env.CHAT_RATE_WINDOW_MS);
  const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : defaultLimit;
  const windowMs = Number.isFinite(configuredWindow) && configuredWindow > 0 ? Math.floor(configuredWindow) : defaultWindowMs;
  const now = Date.now();
  const key = getClientIp(request);
  const current = rateLimitStore.get(key);

  if (rateLimitStore.size > 1000) {
    for (const [entryKey, entry] of rateLimitStore) {
      if (entry.resetAt <= now) rateLimitStore.delete(entryKey);
    }
  }

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: 0, limit };
  }

  current.count += 1;
  if (current.count > limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((current.resetAt - now) / 1000), limit };
  }

  return { allowed: true, remaining: Math.max(0, limit - current.count), retryAfter: 0, limit };
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter), "X-RateLimit-Limit": String(rateLimit.limit), "X-RateLimit-Remaining": "0" } },
    );
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Add GEMINI_API_KEY to your .env.local file to start chatting." }, { status: 500, headers: { "X-RateLimit-Remaining": String(rateLimit.remaining) } });
  try {
    const { messages, model = "Gemini 3.6 Flash" } = await request.json() as { messages?: ChatMessage[]; model?: string };
    if (!messages?.length) return NextResponse.json({ error: "A message is required." }, { status: 400 });
    const modelId = model.includes("Pro") ? "gemini-3.6-pro" : "gemini-3.6-flash";
    const contents = messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const systemInstruction = { parts: [{ text: "You are Lumina, a capable, warm, and practical general-purpose AI assistant. Help with writing, learning, coding, research, planning, analysis, brainstorming, and everyday decisions. Be clear and structured, ask one focused clarifying question only when necessary, state assumptions, and give actionable next steps. Prefer concise answers, but go deeper when the user asks. Never pretend to have browsed or completed an action you could not perform. Use Markdown when it improves scanability." }] };
    let response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system_instruction: systemInstruction, contents }) });
    if (response.status === 429 || response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system_instruction: systemInstruction, contents }) });
    }
    if (!response.ok) {
      const data = await response.json();
      return NextResponse.json({ error: data.error?.message || "Gemini could not complete that request." }, { status: response.status });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify("I couldn’t generate a response for that.")}\n\n`));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        const read = async (): Promise<void> => {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
          const events = buffer.split("\n\n");
          buffer = done ? "" : events.pop() || "";
          for (const event of events) {
            const line = event.split("\n").find((item) => item.startsWith("data:"));
            if (!line) continue;
            try {
              const chunk = JSON.parse(line.slice(5).trim()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
              const text = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
              if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify(text)}\n\n`));
            } catch { /* Ignore incomplete provider events. */ }
          }
          if (done) {
            controller.close();
            return;
          }
          await read();
        };
        read().catch(() => controller.close());
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-RateLimit-Remaining": String(rateLimit.remaining) } });
  } catch { return NextResponse.json({ error: "The request could not be processed. Please try again." }, { status: 500 }); }
}