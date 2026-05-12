# Module documentation iterations

This guide exists so a later session can pick up the next documentation round
without reverse-engineering the repo again.

## Goal

This repo maintains two parallel module reference families:

- native nginz modules: `src/content/docs/reference/modules/<slug>.md`
- scripted nginz-njs modules: `src/content/docs/reference/scripted-modules/<slug>.md`

Each page should help a customer answer four questions quickly:

1. What problem does this module solve?
2. When is it useful in production?
3. What does the `nginx.conf` shape look like?
4. Which other nginz modules pair well with it?

## Source of truth

Use the correct upstream project as the source of truth.

### Native modules (`nginz`)

Use the nginz module README as the source of truth for:

- directive names
- directive contexts
- defaults
- realistic configuration patterns
- confirmed relationships with other modules

### Scripted modules (`nginz-njs`)

Use the nginz-njs project README, per-module README, public `pub fn` source,
and integration tests as the source of truth for:

- the building-block use case
- important public Gleam APIs
- the role of `exports()` as the nginx adapter
- test-backed `nginx.conf` wiring patterns
- confirmed composition relationships with other scripted or native modules

Keep the website documentation less technical than the source README. The goal
is customer clarity, not maintainer completeness.

## Standard page structure

Every module page follows the same shape:

1. frontmatter with `title` and `description`
2. H1 title
3. `## When to use this module`
4. `## nginx.conf synthesis`
5. `## Directive reference` for native modules, or `## Public Gleam API` for scripted modules
6. `## Works well with`

Do not invent a new structure unless the repo intentionally changes the pattern
for all module pages.

## Commands

Scaffold a page:

```bash
npm run scaffold:module -- --slug jwt "JWT Authentication" "Validate bearer tokens at the edge before traffic reaches protected services"
```

Validate structure and links:

```bash
npm run validate:modules
```

Fail when an index still points at undocumented backlog modules:

```bash
npm run validate:modules -- --strict-index
```

Preview locally:

```bash
npm run dev
```

## Iteration workflow

### New module page

1. Read the source README for the target module.
2. Scaffold the page with the correct slug.
3. Fill the placeholders in the generated markdown.
4. Add the module to the correct family index if missing.
5. Add explicit markdown links in `## Works well with`.
6. Run `npm run validate:modules`.
7. Preview the page locally.
8. Run project checks before handing off or committing.

### Existing module refresh

1. Compare the source README with the current website page.
2. Update use cases first, then config example, then directive reference or public API section.
3. Check whether new related-module links should be added.
4. Re-run validation and project checks.

## Writing rules

- Start from customer problems, not implementation trivia.
- Keep the opening paragraph plain-language and outcome-oriented.
- Make the `nginx.conf synthesis` example realistic and minimal.
- Native docs should cover every public directive that matters to customers.
- Scripted docs should cover the important public `pub fn` surface and explain
  how `exports()` exposes that library to nginx.
- Use explicit markdown links in `## Works well with`.
- Do not claim behavior that is not supported by the source README.

## Validation expectations

`npm run validate:modules` checks:

- required headings on every module page in both families
- missing frontmatter fields
- unreplaced template placeholders
- broken module links inside module pages
- index entries that point to missing pages

By default, missing pages referenced from the index are warnings because the
index may intentionally advertise future modules. Use `--strict-index` when a
release or CI job should require the index to be fully implemented.

## Suggested batching strategy

Group modules by theme so cross-links land naturally:

- identity and security
- resilience and traffic control
- observability and diagnostics
- data, transformation, and runtime integrations

For scripted modules, a more natural grouping is:

- transport and orchestration
- policy and state
- shaping and delivery
- observability and operator surfaces

Finish a batch, validate it, then move to the next batch.
