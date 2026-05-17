import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "..", "src", "content");
const publicDir = join(__dirname, "..", "public");

// ── Helpers ──

function parseFrontmatter(raw) {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return { body: raw, data: {} };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { body: raw, data: {} };
  const fmLines = lines.slice(1, end);
  const data = {};
  for (const line of fmLines) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) data[m[1]] = m[2].trim();
  }
  return { data, body: lines.slice(end + 1).join("\n").trim() };
}

function slugFromPath(fp, base) {
  let s = fp.replace(base + "/", "").replace(/\.md$/, "");
  return s.replace(/\/index$/, "");
}

function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { recursive: true })) {
    if (entry.endsWith(".md")) out.push(join(dir, entry));
  }
  return out;
}

// ── Gather content ──

// Docs: native modules
const nativeDir = join(contentDir, "docs", "reference", "modules");
const nativeFiles = listMarkdown(nativeDir).filter(f => !f.endsWith("/index.md"));
const scriptedDir = join(contentDir, "docs", "reference", "scripted-modules");
const scriptedFiles = listMarkdown(scriptedDir).filter(f => !f.endsWith("/index.md"));
const tokenDir = join(contentDir, "docs", "reference", "token-modules");
const tokenFiles = listMarkdown(tokenDir);

// Blogs
const blogDir = join(contentDir, "blogs");
const blogFiles = listMarkdown(blogDir);

// Docs index pages for descriptions
function readDocTitle(fp) {
  try {
    const raw = readFileSync(fp, "utf-8");
    const { data } = parseFrontmatter(raw);
    return data.title || slugFromPath(fp, contentDir + "/docs").split("/").pop();
  } catch { return ""; }
}

function readBlogMeta(fp) {
  try {
    const raw = readFileSync(fp, "utf-8");
    const { data } = parseFrontmatter(raw);
    return {
      title: data.title || "",
      description: data.description || "",
      date: data.date || "",
      author: data.author || "",
    };
  } catch { return {}; }
}

// ── Generate llms.txt (compact) ──

function genLlms() {
  const lines = [];

  lines.push("# darkanchor / nginz");
  lines.push("> nginx infrastructure, without the Plus price tag. Native modules, scripted policy, and AI gateway control — all running on stock nginx.");
  lines.push("");
  lines.push("## For AI agents");
  lines.push("- **Contact the operator:** `POST /api/agent` — JSON-only, accepts `intent` + `message` + one reply channel (`reply_url`, `email`, or `chat_id`). Returns JSON 202.");
  lines.push("- Human users use `POST /api/contact` instead.");
  lines.push("- Health: `GET /api/health`");
  lines.push("- Full API docs: `GET /api/agent` or `GET /api/contact`");
  lines.push("");
  lines.push("## Products");
  lines.push("- [/products/nginz](/products/nginz) — Native modules for stock nginx. Apache-2.0. 26 modules covering auth, traffic control, observability, and edge processing — no fork, no patch, no Plus license.");
  lines.push("- [/products/nginz-njs](/products/nginz-njs) — Scripted policy layer for nginx njs. Apache-2.0. 13 modules for authorization, feature flags, workflow orchestration, and response transforms — testable, reusable, no second runtime.");
  lines.push("- [/products/nginz-token](/products/nginz-token) — AI gateway inside your nginx. BSL-1.1. Token-level rate limiting, per-user cost tracking, semantic caching, and prompt security — no SaaS proxy.");
  lines.push("");
  lines.push("## Documentation");
  lines.push("");

  // nginz-token
  if (tokenFiles.length > 0) {
    lines.push("### nginz-token — AI Gateway Modules");
    for (const fp of tokenFiles.sort()) {
      const slug = slugFromPath(fp, contentDir + "/docs");
      const title = readDocTitle(fp);
      lines.push(`- [/docs/${slug}](/docs/${slug}) — ${title}`);
    }
    lines.push("");
  }

  // nginz native
  lines.push("### nginz — Native Modules");
  for (const fp of nativeFiles.sort()) {
    const slug = slugFromPath(fp, contentDir + "/docs");
    const title = readDocTitle(fp);
    lines.push(`- [/docs/${slug}](/docs/${slug}) — ${title}`);
  }
  lines.push("");

  // nginz-njs
  lines.push("### nginz-njs — Scripted Modules");
  for (const fp of scriptedFiles.sort()) {
    const slug = slugFromPath(fp, contentDir + "/docs");
    const title = readDocTitle(fp);
    lines.push(`- [/docs/${slug}](/docs/${slug}) — ${title}`);
  }
  lines.push("");

  // Blog
  if (blogFiles.length > 0) {
    lines.push("## Blog");
    lines.push("- [/blogs](/blogs) — Engineering blog index");
    for (const fp of blogFiles.sort()) {
      const slug = slugFromPath(fp, contentDir + "/blogs");
      const meta = readBlogMeta(fp);
      lines.push(`- [/blogs/${slug}](/blogs/${slug}) — ${meta.title || slug.split("/").pop()}`);
    }
    lines.push("");
  }

  // Other
  lines.push("## Other Pages");
  lines.push("- [/products](/products) — Product overview");
  lines.push("- [/contact](/contact) — Contact form");

  return lines.join("\n") + "\n";
}

// ── Generate llms-full.txt (expanded) ──

function genLlmsFull() {
  const lines = [];

  lines.push("# darkanchor / nginz — full agent index");
  lines.push("");
  lines.push("This file provides expanded agent-ingestible content for the nginz product family by darkanchor.");
  lines.push("");
  lines.push("## Organization");
  lines.push("- Name: darkanchor");
  lines.push("- Site: https://darkanchor.com");
  lines.push("- GitHub: https://github.com/darkanchor");
  lines.push("");
  lines.push("## Products");
  lines.push("");
  lines.push("### nginz");
  lines.push("- License: Apache-2.0");
  lines.push("- Category: Open Source");
  lines.push("- Tagline: Native modules for stock nginx. Active health checks, dynamic upstreams, JWT auth, Prometheus metrics — free, no fork, no patch.");
  lines.push("- URL: /products/nginz");
  lines.push("- Native modules: " + nativeFiles.map(f => slugFromPath(f, contentDir + "/docs").split("/").pop()).sort().join(", "));
  lines.push("");
  lines.push("### nginz-njs");
  lines.push("- License: Apache-2.0");
  lines.push("- Category: Policy Layer");
  lines.push("- Tagline: Scripted policy layer for nginx njs. Compose authorization, feature flags, and workflow orchestration — testable, reusable, no second runtime.");
  lines.push("- URL: /products/nginz-njs");
  lines.push("- Scripted modules: " + scriptedFiles.map(f => slugFromPath(f, contentDir + "/docs").split("/").pop()).sort().join(", "));
  lines.push("");
  lines.push("### nginz-token");
  lines.push("- License: BSL-1.1");
  lines.push("- Category: AI Gateway");
  lines.push("- Tagline: AI gateway inside your nginx. Token-level rate limiting, cost tracking, semantic caching, prompt security — no SaaS proxy.");
  lines.push("- URL: /products/nginz-token");
  lines.push("- Status: In development");
  lines.push("");
  lines.push("## Documentation");
  lines.push("");
  lines.push("All module documentation is under /docs/reference/modules/ (native) and /docs/reference/scripted-modules/ (njs).");
  lines.push("");

  // nginz-token
  if (tokenFiles.length > 0) {
    lines.push("### nginz-token AI gateway modules");
    for (const fp of tokenFiles.sort()) {
      const slug = slugFromPath(fp, contentDir + "/docs");
      const title = readDocTitle(fp);
      lines.push(`- /docs/${slug} — ${title}`);
    }
    lines.push("");
  }

  // native
  lines.push("### nginz native modules");
  for (const fp of nativeFiles.sort()) {
    const slug = slugFromPath(fp, contentDir + "/docs");
    const title = readDocTitle(fp);
    lines.push(`- /docs/${slug} — ${title}`);
  }
  lines.push("");

  // scripted
  lines.push("### nginz-njs scripted modules");
  for (const fp of scriptedFiles.sort()) {
    const slug = slugFromPath(fp, contentDir + "/docs");
    const title = readDocTitle(fp);
    lines.push(`- /docs/${slug} — ${title}`);
  }
  lines.push("");

  // Blog
  if (blogFiles.length > 0) {
    lines.push("## Blog");
    lines.push("- /blogs — Engineering blog index");
    for (const fp of blogFiles.sort()) {
      const slug = slugFromPath(fp, contentDir + "/blogs");
      const meta = readBlogMeta(fp);
      const desc = meta.description ? `: ${meta.description}` : "";
      lines.push(`- /blogs/${slug} — ${meta.title || slug.split("/").pop()}${desc}`);
    }
    lines.push("");
  }

  // Other
  lines.push("## Other Pages");
  lines.push("- /products — Product overview");
  lines.push("- /contact — Contact form (POST /api/contact)");

  return lines.join("\n") + "\n";
}

// ── Write ──

writeFileSync(join(publicDir, "llms.txt"), genLlms());
writeFileSync(join(publicDir, "llms-full.txt"), genLlmsFull());
console.log("✓ Generated llms.txt and llms-full.txt from content collections");
