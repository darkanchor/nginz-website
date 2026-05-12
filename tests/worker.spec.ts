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

  it("accepts contact submissions as a stub", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "demo@example.com", message: "hello" }),
      }),
      {},
    );
    const body = (await response.json()) as { ok: boolean; kind: string };

    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("contact_stub");
  });

  it("returns not found for unknown routes", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/unknown"), {});
    const body = (await response.json()) as { error: string; pathname: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(body.pathname).toBe("/api/unknown");
  });
});
