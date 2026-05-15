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
    expect(body.error).toBe("Name and message are required.");
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

  it("rejects invalid email on /api/contact", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", message: "hi", email: "not-an-email" }),
      }),
      {},
    );
    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid email");
  });

  it("rejects invalid email from form-encoded submission with HTML error", async () => {
    const formBody = new URLSearchParams({ name: "X", message: "hi", email: "bad" });
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }),
      {},
    );
    const text = await response.text();
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(text).toContain("Invalid email");
    expect(text).toContain("Something went wrong");
  });

  it("rejects non-https reply_url on /api/contact", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", message: "hi", reply_url: "http://evil.com" }),
      }),
      {},
    );
    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid reply_url");
  });

  it("rejects non-numeric chat_id on /api/agent", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", chat_id: "abc123" }),
      }),
      {},
    );
    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid chat_id");
  });

  it("accepts when one reply method is valid despite another being invalid", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", message: "hi", email: "good@example.com", reply_url: "not-a-url" }),
      }),
      {},
    );
    expect(response.status).toBe(202);
  });

  it("rejects overly long messages", async () => {
    const long = "x".repeat(10001);
    const response = await worker.fetch(
      new Request("https://example.com/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: long, email: "a@b.com" }),
      }),
      {},
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("too long");
  });

  it("rejects email with whitespace", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", email: "a @b.com" }),
      }),
      {},
    );
    expect(response.status).toBe(400);
  });

  it("rejects email without domain dot", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", email: "a@localhost" }),
      }),
      {},
    );
    expect(response.status).toBe(400);
  });

  it("escapes HTML in contact form success page", async () => {
    const formBody = new URLSearchParams({ name: "<script>alert('xss')</script>", email: "a@b.com", message: "hi" });
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }),
      {},
    );
    const text = await response.text();
    expect(text).toContain("&lt;script&gt;alert('xss')&lt;/script&gt;");
    expect(text).not.toContain("<script>alert");
  });

  it("allows negative chat_id (Telegram groups)", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", chat_id: "-1001234567890" }),
      }),
      {},
    );
    expect(response.status).toBe(202);
  });

  it("returns not found for unknown routes", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/unknown"), {});
    const body = (await response.json()) as { error: string; pathname: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(body.pathname).toBe("/api/unknown");
  });
});
