export interface Env {
  SITE_URL?: string;
  CONTACT_WEBHOOK_URL?: string;
  CONTACT_KV?: KVNamespace;
  RATELIMIT_KV?: KVNamespace;
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

// ── HTML page template ──
// Inspired by /tmp/email-template.html — calm, crisp, professional.

function pageTemplate(title: string, heading: string, bodyHtml: string, isError = false): string {
  const headingColor = isError ? "#CF222E" : "#1F2328";
  const today = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | darkanchor</title></head>
<body style="margin:0;padding:0;background:#F7F8FA;font-family:system-ui,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F8FA;padding:48px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #D0D7DE;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#2A404A;padding:24px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="color:white;font-size:18px;font-weight:700;letter-spacing:-0.03em;">darkanchor</td>
      <td align="right" style="color:#99DDCC;font-size:13px;font-weight:500;">${today}</td>
    </tr>
    </table>
  </td></tr>
  <tr><td style="padding:32px 32px 24px;color:#1F2328;font-size:14px;line-height:1.6;">
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:${headingColor};letter-spacing:-0.02em;">${heading}</h1>
    ${bodyHtml}
  </td></tr>
  <tr><td style="height:1px;background:#E4E8EC;margin:0 32px;"><div style="height:1px;"></div></td></tr>
  <tr><td style="padding:20px 32px;background:#FFFFFF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="color:#656D76;font-size:12px;line-height:1.5;">
        <strong style="color:#2A404A;">darkanchor</strong><br>
        <a href="https://darkanchor.com" style="color:#656D76;text-decoration:none;">darkanchor.com</a>
      </td>
      <td align="right" style="color:#8B949E;font-size:11px;">nginz · nginz-njs · nginz-token</td>
    </tr>
    </table>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

// ── Rate limiting ──
// Uses KV for durable state across Worker invocations.
// One submission per IP per 5-minute window.
// Stores a timestamp as the value so retryAfter can be calculated precisely.
// Fails open: if KV is unavailable, requests are allowed through.

const RATE_WINDOW_SEC = 300; // 5 minutes

async function checkRateLimit(kv: KVNamespace | undefined, ip: string): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!kv) return { allowed: true, retryAfter: 0 }; // No KV → rate limiting disabled

  const key = `ratelimit:${ip}`;

  try {
    const existing = await kv.get(key);
    if (existing) {
      const storedAt = parseInt(existing, 10);
      if (!isNaN(storedAt)) {
        const elapsed = (Date.now() - storedAt) / 1000;
        if (elapsed < RATE_WINDOW_SEC) {
          const retryAfter = Math.ceil(RATE_WINDOW_SEC - elapsed);
          return { allowed: false, retryAfter };
        }
        // Key exists but window expired — fall through to refresh
      }
    }
  } catch {
    // KV read failed — allow the request (fail open)
    return { allowed: true, retryAfter: 0 };
  }

  // No valid key → first request in window. Set with TTL.
  try {
    await kv.put(key, String(Date.now()), { expirationTtl: RATE_WINDOW_SEC });
  } catch {
    // KV write failed — allow the request but don't enforce (fail open)
  }
  return { allowed: true, retryAfter: 0 };
}

function getClientIp(request: Request): string {
  // Cloudflare provides the real client IP in this header
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;
  // Fallback for local dev
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return "127.0.0.1";
}

// ── Field validators ──
// Each returns an error string if invalid, or null if valid/empty.

function validateEmail(v: string): string | null {
  if (!v) return null;
  // Must have exactly one @, non-empty local and domain parts, domain must contain a dot
  const atIndex = v.indexOf("@");
  if (atIndex < 1 || v.indexOf("@", atIndex + 1) !== -1) {
    return `Invalid email: "${v}". Expected format: user@example.com`;
  }
  const domain = v.slice(atIndex + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return `Invalid email: "${v}". Expected format: user@example.com`;
  }
  if (/\s/.test(v)) {
    return `Invalid email: "${v}". Email must not contain whitespace.`;
  }
  if (v.length > 254) {
    return `Invalid email: "${v}". Email is too long.`;
  }
  return null;
}

function validateReplyUrl(v: string): string | null {
  if (!v) return null;
  if (!v.startsWith("https://")) {
    return `Invalid reply_url: "${v}". Must be an HTTPS URL (e.g. https://mybot.example/webhook).`;
  }
  try {
    new URL(v);
  } catch {
    return `Invalid reply_url: "${v}". Must be a valid HTTPS URL.`;
  }
  return null;
}

function validateChatId(v: string): string | null {
  if (!v) return null;
  // Strip common prefixes bots may accidentally include
  let cleaned = v;
  if (cleaned.startsWith("telegram:")) cleaned = cleaned.slice(9);
  // Telegram chat IDs can be negative (for groups), so allow leading -
  if (!/^-?\d+$/.test(cleaned)) {
    return `Invalid chat_id: "${v}". Must be a numeric Telegram chat ID (e.g. 123456789 or -1001234567890). Do not use prefixes like "telegram:".`;
  }
  // Return cleaned value so callers can use it
  return cleaned;
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

// Escape user-provided values for Telegram's HTML parse mode.
// Only <b>, <i>, <u>, <s>, <code>, <pre>, <a> are safe; escape others.
function tgEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
        audience: "humans",
        description: "Contact form for human users. Accepts form-encoded or JSON POST. Returns an HTML confirmation page on success. If you are an AI agent or bot, use /api/agent instead.",
        agent_endpoint: "/api/agent",
        agent_note: "AI agents and bots should POST to /api/agent, which accepts structured JSON and returns JSON responses (no HTML).",
        required: "name, message, and at least one reply method (email, reply_url, or chat_id).",
        fields: {
          name: "string (required)",
          message: "string (required)",
          email: "string (optional) — email for human follow-up. Must contain @ and a domain.",
          reply_url: "string (optional) — HTTPS webhook for automated replies. Must start with https://",
          chat_id: "string (optional) — Telegram chat ID for bot replies. Bare numeric ID (e.g. 123456789 or -1001234567890). No prefix like 'telegram:'.",
          company: "string (optional)",
          product: "string (optional)",
        },
        validation: "If a reply field is provided but invalid, the request is rejected with a 400 error describing the problem.",
        rate_limiting: "One submission per IP per 5 minutes. Exceeded requests get HTTP 429 with retry_after_seconds.",
        example_form: "name=Jane&email=jane@example.com&company=Acme&product=nginz-token&message=Hello",
        example_json: { name: "Jane", email: "jane@example.com", company: "Acme", product: "nginz-token", message: "Hello" },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/contact") {
      const contentType = request.headers.get("content-type") || "";
      const accept = request.headers.get("accept") || "";
      const wantsJson = contentType.includes("application/json") || accept.includes("application/json");
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const errorReply = (msg: string, status = 400) =>
        wantsJson
          ? json({ error: msg }, status)
          : html(pageTemplate("Error", "Something went wrong", `<p style="margin:0 0 16px;">${esc(msg)}</p><p style="margin:0;"><a href="javascript:history.back()" style="color:#2A404A;text-decoration:underline;text-underline-offset:2px;font-weight:500;">← Go back</a></p>`, true), status);

      // Rate limiting
      const clientIp = getClientIp(request);
      const rateCheck = await checkRateLimit(env.RATELIMIT_KV, clientIp);
      if (!rateCheck.allowed) {
        return errorReply(`Too many requests. Please wait ${Math.ceil(rateCheck.retryAfter / 60)} minute(s) before trying again.`, 429);
      }

      let name = "", email = "", company = "", product = "", message = "", replyUrl = "", chatId = "";
      if (contentType.includes("application/json")) {
        try {
          const body = await request.json() as Record<string, string>;
          name = body.name || "";
          email = body.email || "";
          company = body.company || "";
          product = body.product || "";
          message = body.message || "";
          replyUrl = body.reply_url || "";
          chatId = body.chat_id || "";
        } catch {
          return errorReply("Invalid JSON body.");
        }
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

      // Length limits
      if (name.length > 200) {
        return errorReply("Name is too long (max 200 characters).");
      }
      if (message.length > 10000) {
        return errorReply("Message is too long (max 10,000 characters).");
      }

      if (!name || !message) {
        return errorReply("Name and message are required.");
      }

      // Validate reply fields: collect valid ones, collect errors for invalid ones.
      // Only fail if ALL provided reply methods are invalid (empty counts as invalid).
      // validateChatId returns the cleaned chat_id (or null if empty, or error string if invalid).
      const replyErrors: string[] = [];

      const emailErr = validateEmail(email.trim());
      if (emailErr) replyErrors.push(emailErr);
      const urlErr = validateReplyUrl(replyUrl.trim());
      if (urlErr) replyErrors.push(urlErr);
      const chatResult = validateChatId(chatId.trim());
      const chatErr = chatResult && chatResult.startsWith("Invalid") ? chatResult : null;
      if (chatErr) replyErrors.push(chatErr);

      // A field is "valid" if non-empty and passed validation
      const hasValidEmail = email.trim() && !emailErr;
      const hasValidUrl = replyUrl.trim() && !urlErr;
      const hasValidChat = chatId.trim() && chatResult && !chatErr;
      const cleanedChatId = hasValidChat ? chatResult : "";

      if (!hasValidEmail && !hasValidUrl && !hasValidChat) {
        const detail = replyErrors.length
          ? replyErrors.join("; ")
          : "At least one of email, reply_url, or chat_id is required so the operator can respond.";
        return errorReply(detail);
      }

      // Drop invalid fields so only valid ones reach the operator
      const finalEmail = hasValidEmail ? email.trim() : "";
      const finalReplyUrl = hasValidUrl ? replyUrl.trim() : "";
      const finalChatId = cleanedChatId;

      const payload = {
        kind: "contact",
        name,
        email: finalEmail || undefined,
        reply_url: finalReplyUrl || undefined,
        chat_id: finalChatId || undefined,
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
        const key = `contact:${Date.now()}:${finalEmail || finalReplyUrl || finalChatId}`;
        try {
          await env.CONTACT_KV.put(key, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 90 });
        } catch { /* KV write is best-effort */ }
      }

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const lines = [`<b>📬 New contact</b>`, `<b>Name:</b> ${tgEscape(name)}`];
        if (finalEmail) lines.push(`<b>Email:</b> ${tgEscape(finalEmail)}`);
        if (finalReplyUrl) lines.push(`<b>Reply URL:</b> ${tgEscape(finalReplyUrl)}`);
        if (finalChatId) lines.push(`<b>Chat ID:</b> ${tgEscape(finalChatId)}`);
        lines.push(`<b>Company:</b> ${tgEscape(company) || "—"}`, `<b>Product:</b> ${tgEscape(product) || "—"}`, `<b>Message:</b> ${tgEscape(message.slice(0, 500))}`);
        await notifyTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, lines.join("\n"));
      }

      if (env.TELEGRAM_CHAT_ID_2) {
        const token2 = env.TELEGRAM_BOT_TOKEN_2 || env.TELEGRAM_BOT_TOKEN;
        if (token2) {
          const lines = [`<b>📬 New contact</b>`, `<b>Name:</b> ${tgEscape(name)}`];
          if (finalEmail) lines.push(`<b>Email:</b> ${tgEscape(finalEmail)}`);
          if (finalReplyUrl) lines.push(`<b>Reply URL:</b> ${tgEscape(finalReplyUrl)}`);
          if (finalChatId) lines.push(`<b>Chat ID:</b> ${tgEscape(finalChatId)}`);
          lines.push(`<b>Company:</b> ${tgEscape(company) || "—"}`, `<b>Product:</b> ${tgEscape(product) || "—"}`, `<b>Message:</b> ${tgEscape(message)}`);
          await notifyTelegram(token2, env.TELEGRAM_CHAT_ID_2, lines.join("\n"));
        }
      }

      // Content negotiation: JSON callers get JSON, form submissions get HTML
      if (wantsJson) {
        return json({
          ok: true,
          message: `Thanks, ${name}. We'll get back to you soon — a human, or a bot, maybe both. 🚀`,
          preferred_endpoint: "/api/agent",
          note: "This submission was accepted, but /api/agent is the canonical contact endpoint for AI agents and bots. Next time, POST to /api/agent for a fully structured agent-to-agent experience.",
        }, 202);
      }

      // Return a friendly HTML confirmation with auto-redirect
      const successHtml = pageTemplate(
        "Message sent",
        "Message sent",
        `<p style="margin:0 0 16px;">Thanks, ${esc(name)}. We'll get back to you soon — a human, or a bot, maybe both. 🚀</p><p style="margin:0 0 16px;color:#656D76;font-size:13px;">You'll be taken back to the homepage in <span id="countdown">5</span> seconds.</p><p style="margin:0;"><a href="/" style="color:#2A404A;text-decoration:underline;text-underline-offset:2px;font-weight:500;">← Back to darkanchor</a></p><script>var n=5;var el=document.getElementById('countdown');var t=setInterval(function(){n--;if(n<=0){clearInterval(t);window.location.replace('/');}else{el.textContent=n;}},1000);</script>`,
      );
      return html(successHtml);
    }

    // ── Agent-to-Agent Contact ──
    if (request.method === "GET" && url.pathname === "/api/agent") {
      const hasTelegram = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
      return json({
        endpoint: "/api/agent",
        method: "POST",
        audience: "ai_agents_and_bots",
        description: "Agent-to-agent structured inquiry endpoint. This is the canonical contact endpoint for AI agents, bots, and automated systems. Accepts JSON payloads from AI agents operating on behalf of users. POST your inquiry as JSON and the operator will be notified. Human users should use /api/contact instead.",
        human_endpoint: "/api/contact",
        human_note: "Human users should POST to /api/contact, which accepts form-encoded data and returns an HTML confirmation page.",
        required_reply_field: "At least one of reply_url, email, or chat_id must be provided so the operator can respond.",
        schema: {
          intent: "string (optional) — e.g. sales, support, partnership",
          message: "string (required) — the inquiry body",
          reply_url: "string (optional) — HTTPS webhook URL. Must start with https://",
          email: "string (optional) — email address. Must contain @ and a domain.",
          chat_id: "string (optional) — Telegram chat ID. Bare numeric ID (e.g. 123456789 or -1001234567890). No prefix like 'telegram:'.",
        },
        validation: "If a reply field is provided but invalid, the request is rejected with a 400 error describing the problem.",
        rate_limiting: "One submission per IP per 5 minutes. Exceeded requests get HTTP 429 with retry_after_seconds.",
        contact: hasTelegram
          ? { via: "telegram", note: "The operator receives inquiries via Telegram. POST your message here and they will be notified." }
          : { note: "Inquiries are stored and forwarded. The operator will follow up if needed." },
        example: { intent: "sales", email: "user@example.com", reply_url: "https://myagent.example/webhook", message: "I represent a company interested in nginz-token." },
        example_telegram_bot: { intent: "support", chat_id: "123456789", message: "User 456 needs help with nginz-token rate limiting." },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/agent") {
      // Rate limiting
      const clientIp = getClientIp(request);
      const rateCheck = await checkRateLimit(env.RATELIMIT_KV, clientIp);
      if (!rateCheck.allowed) {
        return json({
          error: "rate_limited",
          message: `Too many requests. Please wait ${Math.ceil(rateCheck.retryAfter / 60)} minute(s) before trying again.`,
          retry_after_seconds: rateCheck.retryAfter,
        }, 429);
      }

      let body: Record<string, unknown> = {};
      try {
        body = await request.json() as Record<string, unknown>;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }

      // Length limits
      const rawMessage = typeof body.message === "string" ? body.message : "";
      if (rawMessage.length > 10000) {
        return json({ error: "Message is too long (max 10,000 characters)." }, 400);
      }
      if (!rawMessage.trim()) {
        return json({ error: "Message is required." }, 400);
      }

      // Validate: at least one reply channel must be provided and valid
      const replyUrl = typeof body.reply_url === "string" ? body.reply_url.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const chatId = typeof body.chat_id === "string" ? body.chat_id.trim() : "";

      // Validate reply field formats — collect errors, accept if any one is valid
      // validateChatId returns the cleaned chat_id (or null if empty, or error string if invalid).
      const replyErrors: string[] = [];
      const emailErr = validateEmail(email);
      if (emailErr) replyErrors.push(emailErr);
      const urlErr = validateReplyUrl(replyUrl);
      if (urlErr) replyErrors.push(urlErr);
      const chatResult = validateChatId(chatId);
      const chatErr = chatResult && chatResult.startsWith("Invalid") ? chatResult : null;
      if (chatErr) replyErrors.push(chatErr);

      const hasValidEmail = email && !emailErr;
      const hasValidUrl = replyUrl && !urlErr;
      const hasValidChat = chatId && chatResult && !chatErr;
      const cleanedChatId = hasValidChat ? chatResult : "";

      if (!hasValidEmail && !hasValidUrl && !hasValidChat) {
        const detail = replyErrors.length
          ? replyErrors.join("; ")
          : "At least one of reply_url, email, or chat_id is required so the operator can respond.";
        return json({ error: detail }, 400);
      }

      const finalEmail = hasValidEmail ? email : "";
      const finalReplyUrl = hasValidUrl ? replyUrl : "";
      const finalChatId = cleanedChatId;

      const payload = {
        kind: "agent_inquiry",
        intent: body.intent,
        message: body.message,
        reply_url: finalReplyUrl || undefined,
        email: finalEmail || undefined,
        chat_id: finalChatId || undefined,
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
        const intent = tgEscape(String(body.intent || "general"));
        const msg = tgEscape(String(body.message || "").slice(0, 500));
        const lines = [`<b>🤖 Agent inquiry</b>`, `<b>Intent:</b> ${intent}`];
        if (finalEmail) lines.push(`<b>Email:</b> ${tgEscape(finalEmail)}`);
        if (finalReplyUrl) lines.push(`<b>Reply URL:</b> ${tgEscape(finalReplyUrl)}`);
        if (finalChatId) lines.push(`<b>Chat ID:</b> ${tgEscape(finalChatId)}`);
        lines.push(`<b>Message:</b> ${msg}`);
        await notifyTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, lines.join("\n"));
      }

      if (env.TELEGRAM_CHAT_ID_2) {
        const token2 = env.TELEGRAM_BOT_TOKEN_2 || env.TELEGRAM_BOT_TOKEN;
        if (token2) {
          const intent = tgEscape(String(body.intent || "general"));
          const msg = tgEscape(String(body.message || ""));
          const lines = [`<b>🤖 Agent inquiry</b>`, `<b>Intent:</b> ${intent}`];
          if (finalEmail) lines.push(`<b>Email:</b> ${tgEscape(finalEmail)}`);
          if (finalReplyUrl) lines.push(`<b>Reply URL:</b> ${tgEscape(finalReplyUrl)}`);
          if (finalChatId) lines.push(`<b>Chat ID:</b> ${tgEscape(finalChatId)}`);
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
