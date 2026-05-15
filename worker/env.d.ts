/// <reference types="@cloudflare/workers-types" />

// Extend the Worker Env interface with bindings this service expects.
// Add KV namespaces, R2 buckets, Queues, secrets, or environment variables here.
// All values are strings unless decorated with a Workers binding annotation.
//
// Usage in handler:
//   export default { async fetch(request, env, ctx) { ... } }
//
// References:
//   - https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/

declare global {
  interface Env {
    // Environment variables
    SITE_URL?: string;

    // Secrets
    CONTACT_WEBHOOK_URL?: string;
    PADDLE_WEBHOOK_SECRET?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    TELEGRAM_BOT_TOKEN_2?: string;
    TELEGRAM_CHAT_ID_2?: string;

    // KV namespace for contact form storage (optional but recommended)
    CONTACT_KV?: KVNamespace;

    // KV namespace for rate limiting (optional — disabled if not bound)
    RATELIMIT_KV?: KVNamespace;

    // --- Future bindings (uncomment as needed) ---
    // KV_NAMESPACE: KVNamespace;
    // R2_BUCKET: R2Bucket;
    // AI: Ai;
  }
}

export {};
