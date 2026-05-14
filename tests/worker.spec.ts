import { describe, expect, it } from "vitest";
import worker from "../worker/index";

describe("worker routes", () => {
  it("returns a health payload", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/health"), {});
    const body = (await response.json()) as { ok: boolean; service: string };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("nginz-website-worker");
  });

  it("accepts contact submissions and returns JSON for JSON callers", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Demo", email: "demo@example.com", message: "hello" }),
      }),
      {},
    );
    const body = (await response.json()) as { ok: boolean; message: string };

    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.message).toContain("Demo");
  });

  it("returns HTML confirmation for form-encoded contact submissions", async () => {
    const formBody = new URLSearchParams({ name: "Demo", email: "demo@example.com", message: "hello" });
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }),
      {},
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(text).toContain("Message sent");
    expect(text).toContain("Demo");
  });

  it("rejects contact submissions without name or message", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "demo@example.com" }),
      }),
      {},
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("name and message are required");
  });

  it("accepts agent inquiries and returns JSON", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "sales", email: "bot@example.com", message: "Interested in nginz-token" }),
      }),
      {},
    );
    const body = (await response.json()) as { ok: boolean; message: string };

    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.message).toContain("Inquiry received");
  });

  it("returns not found for unknown routes", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/unknown"), {});
    const body = (await response.json()) as { error: string; pathname: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(body.pathname).toBe("/api/unknown");
  });
});
