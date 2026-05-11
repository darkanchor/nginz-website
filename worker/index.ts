export interface Env {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function notFound(pathname: string): Response {
  return json({ error: "not_found", pathname }, 404);
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "nginz-website-worker" });
    }

    if (request.method === "POST" && url.pathname === "/api/contact") {
      return json({ ok: true, kind: "contact_stub" }, 202);
    }

    if (request.method === "POST" && url.pathname === "/api/payment") {
      return json({ ok: true, kind: "payment_stub" }, 202);
    }

    if (request.method === "POST" && url.pathname === "/api/agent") {
      return json({ ok: true, kind: "agent_stub" }, 202);
    }

    return notFound(url.pathname);
  },
};
