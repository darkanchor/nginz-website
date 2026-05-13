export interface Env {
  SITE_URL?: string;
  CONTACT_WEBHOOK_URL?: string;
  CONTACT_KV?: KVNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  // Optional second bot for automated storage + reply.
  // Falls back to TELEGRAM_BOT_TOKEN when only a second chat id is set.
  TELEGRAM_BOT_TOKEN_2?: string;
  TELEGRAM_CHAT_ID_2?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function notFound(pathname: string): Response {
  return json({ error: "not_found", pathname }, 404);
}

async function forwardToWebhook(payload: Record<string, unknown>, webhookUrl: string): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Webhook delivery is best-effort; do not fail the request
  }
}

async function notifyTelegram(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch {
    // Telegram delivery is best-effort
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── Health ──
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "nginz-website-worker" });
    }

    // ── Human Contact Form ──
    if (request.method === "GET" && url.pathname === "/api/contact") {
      return json({
        endpoint: "/api/contact",
        method: "POST",
        description: "Human contact form endpoint. Accepts form-encoded or JSON POST.",
        required: "name, message, and at least one reply method (email, reply_url, or chat_id).",
        fields: {
          name: "string (required)",
          message: "string (required)",
          email: "string (optional) — email for human follow-up",
          reply_url: "string (optional) — HTTPS webhook for automated replies",
          chat_id: "string (optional) — Telegram chat ID for bot replies",
          company: "string (optional)",
          product: "string (optional)",
        },
        example_form: "name=Jane&email=jane@example.com&company=Acme&product=nginz-token&message=Hello",
        example_json: { name: "Jane", email: "jane@example.com", company: "Acme", product: "nginz-token", message: "Hello" },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/contact") {
      let name = "", email = "", company = "", product = "", message = "", replyUrl = "", chatId = "";

      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await request.json() as Record<string, string>;
        name = body.name || "";
        email = body.email || "";
        company = body.company || "";
        product = body.product || "";
        message = body.message || "";
        replyUrl = body.reply_url || "";
        chatId = body.chat_id || "";
      } else {
        const formData = await request.formData();
        name = (formData.get("name") as string) || "";
        email = (formData.get("email") as string) || "";
        company = (formData.get("company") as string) || "";
        product = (formData.get("product") as string) || "";
        message = (formData.get("message") as string) || "";
        replyUrl = (formData.get("reply_url") as string) || "";
        chatId = (formData.get("chat_id") as string) || "";
      }

      if (!name || !message) {
        return json({ error: "name and message are required" }, 400);
      }

      const hasReply = email.trim() || replyUrl.trim() || chatId.trim();
      if (!hasReply) {
        return json({
          error: "missing_reply_target",
          message: "At least one of email, reply_url, or chat_id is required so the operator can respond.",
        }, 400);
      }

      const payload = {
        kind: "contact",
        name,
        email: email || undefined,
        reply_url: replyUrl || undefined,
        chat_id: chatId || undefined,
        company,
        product,
        message,
        submitted_at: new Date().toISOString(),
      };

      // Forward to webhook if configured
      if (env.CONTACT_WEBHOOK_URL) {
        await forwardToWebhook(payload, env.CONTACT_WEBHOOK_URL);
      }

      // Store in KV if available (durable backup)
      if (env.CONTACT_KV) {
        const key = `contact:${Date.now()}:${email || replyUrl || chatId}`;
        try {
          await env.CONTACT_KV.put(key, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 90 });
        } catch { /* KV write is best-effort */ }
      }

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const lines = [`<b>📬 New contact</b>`, `<b>Name:</b> ${name}`];
        if (email) lines.push(`<b>Email:</b> ${email}`);
        if (replyUrl) lines.push(`<b>Reply URL:</b> ${replyUrl}`);
        if (chatId) lines.push(`<b>Chat ID:</b> ${chatId}`);
        lines.push(`<b>Company:</b> ${company || "—"}`, `<b>Product:</b> ${product || "—"}`, `<b>Message:</b> ${message.slice(0, 500)}`);
        await notifyTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, lines.join("\n"));
      }

      if (env.TELEGRAM_CHAT_ID_2) {
        const token2 = env.TELEGRAM_BOT_TOKEN_2 || env.TELEGRAM_BOT_TOKEN;
        if (token2) {
          const lines = [`<b>📬 New contact</b>`, `<b>Name:</b> ${name}`];
          if (email) lines.push(`<b>Email:</b> ${email}`);
          if (replyUrl) lines.push(`<b>Reply URL:</b> ${replyUrl}`);
          if (chatId) lines.push(`<b>Chat ID:</b> ${chatId}`);
          lines.push(`<b>Company:</b> ${company || "—"}`, `<b>Product:</b> ${product || "—"}`, `<b>Message:</b> ${message}`);
          await notifyTelegram(token2, env.TELEGRAM_CHAT_ID_2, lines.join("\n"));
        }
      }

      // Return a friendly HTML confirmation
      return html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Message sent | darkanchor</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; text-align: center; color: #1F2328; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #656D76; line-height: 1.6; }
  a { color: #2A404A; }
</style></head>
<body>
  <h1>Message sent</h1>
  <p>Thanks, ${name}. We'll get back to you within one business day.</p>
  <p><a href="/">Back to darkanchor</a></p>
</body>
</html>`);
    }

    // ── Agent-to-Agent Contact ──
    if (request.method === "GET" && url.pathname === "/api/agent") {
      const hasTelegram = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
      return json({
        endpoint: "/api/agent",
        method: "POST",
        description: "Agent-to-agent structured inquiry endpoint. Accepts JSON payloads from AI agents operating on behalf of users. POST your inquiry as JSON and the operator will be notified.",
        required_reply_field: "At least one of reply_url, email, or chat_id must be provided so the operator can respond.",
        schema: {
          intent: "string (optional) — e.g. sales, support, partnership",
          message: "string (required) — the inquiry body",
          reply_url: "string (optional) — HTTPS webhook URL the operator can POST replies to",
          email: "string (optional) — email address for human follow-up",
          chat_id: "string (optional) — Telegram chat ID if you are a Telegram bot",
        },
        contact: hasTelegram
          ? { via: "telegram", note: "The operator receives inquiries via Telegram. POST your message here and they will be notified." }
          : { note: "Inquiries are stored and forwarded. The operator will follow up if needed." },
        example: { intent: "sales", email: "user@example.com", reply_url: "https://myagent.example/webhook", message: "I represent a company interested in nginz-token." },
        example_telegram_bot: { intent: "support", chat_id: "123456789", message: "User 456 needs help with nginz-token rate limiting." },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/agent") {
      let body: Record<string, unknown> = {};
      try {
        body = await request.json() as Record<string, unknown>;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }

      // Validate: at least one reply channel must be provided
      const replyUrl = typeof body.reply_url === "string" ? body.reply_url.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const chatId = typeof body.chat_id === "string" ? body.chat_id.trim() : "";

      if (!replyUrl && !email && !chatId) {
        return json({
          error: "missing_reply_target",
          message: "At least one of reply_url, email, or chat_id is required so the operator can respond.",
        }, 400);
      }

      const payload = {
        kind: "agent_inquiry",
        intent: body.intent,
        message: body.message,
        reply_url: replyUrl || undefined,
        email: email || undefined,
        chat_id: chatId || undefined,
        received_at: new Date().toISOString(),
      };

      if (env.CONTACT_WEBHOOK_URL) {
        await forwardToWebhook(payload, env.CONTACT_WEBHOOK_URL);
      }

      if (env.CONTACT_KV) {
        const key = `agent:${Date.now()}`;
        try {
          await env.CONTACT_KV.put(key, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 90 });
        } catch { /* KV write is best-effort */ }
      }

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const intent = String(body.intent || "general");
        const msg = String(body.message || "").slice(0, 500);
        const lines = [`<b>🤖 Agent inquiry</b>`, `<b>Intent:</b> ${intent}`];
        if (email) lines.push(`<b>Email:</b> ${email}`);
        if (replyUrl) lines.push(`<b>Reply URL:</b> ${replyUrl}`);
        if (chatId) lines.push(`<b>Chat ID:</b> ${chatId}`);
        lines.push(`<b>Message:</b> ${msg}`);
        await notifyTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, lines.join("\n"));
      }

      if (env.TELEGRAM_CHAT_ID_2) {
        const token2 = env.TELEGRAM_BOT_TOKEN_2 || env.TELEGRAM_BOT_TOKEN;
        if (token2) {
          const intent = String(body.intent || "general");
          const msg = String(body.message || "");
          const lines = [`<b>🤖 Agent inquiry</b>`, `<b>Intent:</b> ${intent}`];
          if (email) lines.push(`<b>Email:</b> ${email}`);
          if (replyUrl) lines.push(`<b>Reply URL:</b> ${replyUrl}`);
          if (chatId) lines.push(`<b>Chat ID:</b> ${chatId}`);
          lines.push(`<b>Message:</b> ${msg}`);
          await notifyTelegram(token2, env.TELEGRAM_CHAT_ID_2, lines.join("\n"));
        }
      }

      return json({ ok: true, message: "Inquiry received. A human will follow up if needed." }, 202);
    }

    // ── Payment (stub — not yet live) ──
    if (request.method === "POST" && url.pathname === "/api/payment") {
      return json({ ok: true, kind: "payment_stub" }, 202);
    }

    return notFound(url.pathname);
  },
};
