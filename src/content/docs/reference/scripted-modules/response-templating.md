---
title: Response Templating
description: Lightweight response generation from templates with named placeholder substitution, request-variable binding, and registry-based selection.
---

# Response Templating

Use this module when nginx should produce the response itself rather than only proxying or mutating one. It fills named `{{placeholder}}` tokens from request variables or explicit values, letting you build structured text and JSON responses without scattering string-building across handlers.

## When to use this module

- You need a friendly maintenance page, a richer deny response, or a small diagnostic endpoint assembled from request context.
- You want to render JSON or text fragments from nginx variables without a full application upstream.
- You need conditional template selection: choose one template or another based on a boolean condition or response status code.
- You want to keep response generation reusable and testable instead of building strings inline in handler code.

## nginx.conf synthesis

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        location /render {
            js_content main.render_demo;
        }

        location /render-safe {
            js_content main.render_safe_demo;
        }

        location /render-json {
            js_content main.render_json_demo;
        }

        location /from-request {
            # Reads $arg_name and $arg_mode, falls back to guest/standard
            js_content main.render_from_request;
        }

        location /from-vars {
            set $name "Casey";
            js_content main.render_from_vars;
        }

        location /describe {
            js_content main.describe;
        }
    }
}
```

`render_from_request` pulls values from `$arg_name` and `$arg_mode`, falling back to `guest` and `standard`. `render_from_vars` pulls values from nginx variables named after the template placeholders, falling back to the placeholder name when a variable is absent.

## Public Gleam API

### Template model (`response_templating/model`)

| Type | Description |
|---|---|
| `Template` | Named template with ordered placeholder tokens and a kind (text or JSON) |
| `TemplateKind` | `Text` or `Json` |
| `Binding` | `Value(name, value)` pairs for rendering |

| Function | Description |
|---|---|
| `demo_template()` | Stable demo text template for scaffold verification |
| `demo_json_template()` | JSON demo template for handler and contract proof |
| `summary(Template)` | Human-readable template summary |

### Rendering (`response_templating/render`)

| Function | Description |
|---|---|
| `render(Template, List(Binding))` | Fills `{{name}}` placeholders from bindings; missing bindings produce an error |
| `render_safe(Template, List(Binding))` | Preserves missing placeholders as `{{name}}` |
| `render_with_defaults(Template, List(Binding))` | Defaults missing placeholders to their names |
| `binding(name, value)` | Helper constructor for a single binding |

### Variable binding (`response_templating/vars`)

| Function | Description |
|---|---|
| `from_request(r, List(String))` | Build bindings from nginx request variables |
| `from_dict(Dict(String,String))` | Turn string-keyed runtime facts into bindings |
| `merge(List(Binding), List(Binding))` | Combine binding sets with override precedence |

### Registry and conditional selection (`response_templating/registry`, `response_templating/conditional`)

| Function | Description |
|---|---|
| `Registry` / `new()` | Named template registry |
| `register(Registry, Template)` / `lookup(Registry, String)` | Add and retrieve templates by name |
| `select(String, List(Binding), Registry)` | Choose a template by name with fallback |
| `render_if(Bool, Template, Template)` | Render one of two templates from a boolean condition |
| `select_by_status(String, Int, Registry)` | Choose a template using `<prefix>_<status>` / `<prefix>_default` lookup |

## Works well with

- Stock nginx `return` — use `return` for simple fixed responses; templating adds variable interpolation, conditional selection, and JSON rendering.
- [Response Transform](/docs/reference/scripted-modules/response-transform) for mutating existing payloads. Templating generates fresh output; transform edits output that already exists. They are complements, not alternatives.
- [AuthZ](/docs/reference/scripted-modules/authz) for rendering richer deny or challenge responses.
- [Workflow](/docs/reference/scripted-modules/workflow) for generating one-time diagnostic or maintenance responses during orchestration.
- [Control API](/docs/reference/scripted-modules/control-api) for serving template-defined operator surfaces.
