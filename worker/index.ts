export interface Env {
  SITE_URL?: string;
  CONTACT_WEBHOOK_URL?: string;
  CONTACT_KV?: KVNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
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
    if (request.method === "POST" && url.pathname === "/api/contact") {
      let name = "", email = "", company = "", product = "", message = "";

      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await request.json() as Record<string, string>;
        name = body.name || "";
        email = body.email || "";
        company = body.company || "";
        product = body.product || "";
        message = body.message || "";
      } else {
        const formData = await request.formData();
        name = (formData.get("name") as string) || "";
        email = (formData.get("email") as string) || "";
        company = (formData.get("company") as string) || "";
        product = (formData.get("product") as string) || "";
        message = (formData.get("message") as string) || "";
      }

      if (!name || !email || !message) {
        return json({ error: "name, email, and message are required" }, 400);
      }

      const payload = {
        kind: "contact",
        name,
        email,
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
        const key = `contact:${Date.now()}:${email}`;
        try {
          await env.CONTACT_KV.put(key, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 90 });
        } catch { /* KV write is best-effort */ }
      }

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const text = `<b>📬 New contact</b>\n<b>Name:</b> ${name}\n<b>Email:</b> ${email}\n<b>Company:</b> ${company || "—"}\n<b>Product:</b> ${product || "—"}\n<b>Message:</b> ${message.slice(0, 500)}`;
        await notifyTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, text);
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
        contact: hasTelegram
          ? { via: "telegram", note: "The operator receives inquiries via Telegram. POST your message here and they will be notified." }
          : { note: "Inquiries are stored and forwarded. The operator will follow up if needed." },
        example: { intent: "sales", contact: "user@example.com", message: "I represent a company interested in nginz-token." },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/agent") {
      let body: Record<string, unknown> = {};
      try {
        body = await request.json() as Record<string, unknown>;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }

      const payload = {
        kind: "agent_inquiry",
        ...body,
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
        const contact = String(body.contact || body.email || "not provided");
        const text = `<b>🤖 Agent inquiry</b>\n<b>Intent:</b> ${intent}\n<b>Contact:</b> ${contact}\n<b>Message:</b> ${msg}`;
        await notifyTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, text);
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
