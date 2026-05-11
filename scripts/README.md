# scripts — Developer toolkit

Utilities for local dev, build, test, and **module documentation iteration**.

## Available scripts

| Command                          | Description                                      |
| -------------------------------- | ------------------------------------------------ |
| `npm run dev`                    | Start Astro + Worker together                    |
| `npm run dev:site`               | Start Astro dev server on :4321                  |
| `npm run dev:worker`             | Start Worker dev server on :8788                 |
| `npm run build`                  | Build site and validate Worker                   |
| `npm run preview`                | Preview built site locally                       |
| `npm run check`                  | Astro type checking                              |
| `npm run check:worker`           | Worker TypeScript check                          |
| `npm run test`                   | Astro check, Worker check, and tests             |
| `npm run validate:modules`       | Validate module doc structure and cross-links    |
| `npm run scaffold:module`        | Scaffold a new module doc from template          |
| `npm run clean`                  | Remove build artifacts                           |

---

## Module documentation toolkit

Native module reference docs live in `src/content/docs/reference/modules/`.
Each module has one `.md` file using a consistent structure:

```
---
title: Module Name
description: One-line explanation of what the module does.
---

# Module Name

## When to use this module

## nginx.conf synthesis

## Directive reference

## Works well with
```

The toolkit provides three helpers to make documentation iteration durable
and repeatable across sessions.

### Template

**`scripts/templates/module-doc.md`**

A reusable starting point with all required sections and `$PLACEHOLDER`
tokens. When starting a new module doc, either use the scaffold script (see
below) or copy this template manually.

### Scaffold a new module doc

```bash
npm run scaffold:module -- --slug ratelimit "Rate Limiting" "Enforce request rate limits per client IP or zone"
```

This creates `src/content/docs/reference/modules/ratelimit.md` from the
template with `title` and `description` frontmatter pre-filled. The
remaining placeholders (`$USE_CASE_*`, `$DIRECTIVE_*`, etc.) are left for
you to fill manually since they require domain judgment.

Pass an explicit slug whenever the customer-facing title differs from the
native module name. That keeps URLs aligned with the actual nginz module
directory and the reference index.

If run without arguments the script prompts interactively:

```bash
npm run scaffold:module
```

After scaffolding:
1. Fill in all `$PLACEHOLDER` tokens in the new file.
2. Add the module to the index at `src/content/docs/reference/modules/index.md`.
3. Run validation to confirm everything is wired: `npm run validate:modules`.

### Validate module docs

```bash
npm run validate:modules
```

The validation script performs three checks:

**1. Page structure** — every module `.md` file (except `index.md`) is
checked for:
- `title` in frontmatter
- `description` in frontmatter
- `# H1` heading
- `## When to use this module`
- `## nginx.conf synthesis`
- `## Directive reference`
- `## Works well with`

**2. Index health** — the script parses `index.md` and verifies that every
module referenced by URL (`/docs/reference/modules/<slug>`) has a
corresponding `.md` file. By default missing pages are warnings because the
index intentionally includes future modules. Use strict mode to fail on
those gaps:

```bash
npm run validate:modules -- --strict-index
```

The script also warns about `.md` files that exist but are not listed in the
index.

**3. Module cross-link health** — the script scans explicit
`/docs/reference/modules/<slug>` links inside module pages and fails if any
linked page is missing.

Errors produce a non-zero exit code (useful for CI). Warnings are advisory
and do not fail the run.

---

## Maintainer process guide

### Iterative documentation rounds

This repo supports repeated documentation rounds for new and existing
modules. A typical iteration cycle looks like:

```
Round N                          Round N+1
  │                                │
  ├─ scaffold new module doc       ├─ scaffold another module doc
  ├─ fill in template              ├─ fill in template
  ├─ add to index.md               ├─ add to index.md
  ├─ run validate:modules          ├─ run validate:modules
  └─ fix any issues                └─ fix any issues
```

### Step-by-step workflow for a new module doc

1. **Identify the module** — determine the module name, its directives, and
   its use cases. The nginz source tree (`src/`) is the authority for
   directive names, contexts, and defaults.

2. **Scaffold** — run `npm run scaffold:module -- --slug module-slug "Module Name" "Description"`.
   This creates the `.md` file from template.

3. **Fill in the template** — replace every `$PLACEHOLDER`:
   - `$MODULE_USE_CASE` — a short sentence completing "Use this module when…"
   - `$USE_CASE_*` — bullet-list of concrete scenarios
   - `$NGINX_CONF_EXAMPLE` — a realistic nginx.conf snippet
   - `$NGINX_CONF_EXPLANATION` — 1-2 sentences explaining the snippet
   - Add one `### ` sub-section per directive with context, default, and
     description (follow the pattern in existing docs like `echoz.md` or
     `acme.md`)
   - `$RELATED_MODULE_*` and `$RELATED_MODULE_*_SLUG` — cross-links to other
      modules with a brief explanation of why they pair well

4. **Register in the index** — add a bullet under the appropriate category
   in `src/content/docs/reference/modules/index.md`:
   ```markdown
   - [Module Name](/docs/reference/modules/module-slug)
   ```

5. **Validate** — run `npm run validate:modules` and fix any errors. Use
   `npm run validate:modules -- --strict-index` when you want backlog gaps in
   the reference index to fail the run.

6. **View** — `npm run dev` and navigate to `/docs/reference/modules/<slug>`
   to preview the rendered page.

### Quality expectations

- Every module doc must answer the four questions from the index:
  1. What problem does this module solve?
  2. When is it actually useful?
  3. What does the nginx.conf shape look like?
  4. Which other modules work well with it?
- Directives must list all applicable **contexts** and the **default value**.
- Examples in `nginx.conf synthesis` must be realistic (copy-pasteable with
  minimal changes).
- Cross-links in "Works well with" should use explicit markdown links and
  refer to actual existing module pages (use `npm run validate:modules` to
  catch dead links).
- Keep description one line; avoid inline HTML or Astro components in module
  docs.

### Handling existing docs

When updating an existing module doc:
- Do not restructure the headings (the validation script enforces them).
- Add directives or use cases as the module evolves.
- Update the `nginx.conf synthesis` example if the recommended configuration
  pattern changes.
- Re-run validation after any change.

### CI integration (future)

The validation script exits non-zero on errors, making it suitable for CI
gating. To add it to a workflow:

```yaml
- run: npm run validate:modules -- --strict-index
```

For a fuller operator guide, see
`docs/maintainers/module-doc-iterations.md`.
