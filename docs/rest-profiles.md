# Custom REST profiles

A **REST profile** teaches `/doc-wiki:atlas`'s Phase 1b inventory how to recognise HTTP routes in a particular framework. Eighteen profiles ship with doc-wiki today (Express, FastAPI, Spring, Rails, Django, Flask, ASP.NET, Gin, Laravel, Hono, Fastify, Koa, Echo, Rocket, Actix, Slim, Phoenix, Vapor — see [`agents/lib/rest_profiles/`](../agents/lib/rest_profiles/)). When your repo uses a framework that isn't on that list — or an in-house RPC façade with a custom calling convention — author a profile so atlas can include those endpoints in the inventory and downstream gap report.

## Table of contents

- [Where profiles live](#where-profiles-live)
- [The profile schema](#the-profile-schema)
- [Authoring a profile end to end](#authoring-a-profile-end-to-end)
- [Worked examples](#worked-examples)
  - [Plain method-on-app routes (Express-style)](#plain-method-on-app-routes-express-style)
  - [Annotation-attached routes (Spring-style)](#annotation-attached-routes-spring-style)
  - [Default-GET routes (Flask-style)](#default-get-routes-flask-style)
  - [Class-prefixed routes (ASP.NET-style)](#class-prefixed-routes-aspnet-style)
- [Testing a profile](#testing-a-profile)
- [What deduplication does](#what-deduplication-does)

## Where profiles live

| Source | Loaded by | When to use it |
|---|---|---|
| Shipped: [`agents/lib/rest_profiles/<name>.yaml`](../agents/lib/rest_profiles/) | Auto-discovered by `atlas_inventory.js` | A new well-known framework that should benefit every doc-wiki user. Send a PR. |
| Custom: `ecosystem.rest.custom_profiles` in [`wiki.config.yaml`](configuration.md#ecosystem-section) | Read at inventory time, merged with shipped profiles | An in-house framework / RPC façade specific to your repo. Stays local. |

Custom profiles win on name collision, so you can also override a shipped profile's matcher locally without touching the doc-wiki repo.

## The profile schema

A profile is a single YAML object with this shape:

```yaml
name: <string>            # unique identifier; collision-key against shipped profiles
language: <string>        # "python" | "typescript" | "go" | "java" | … (informational)
description: <string>     # one-line summary, surfaced in error messages

detection:
  file_patterns:          # globs handed to walkCodebase; the union across all profiles
    - "**/*.ts"           #   is the file set walked once per atlas run
  markers:                # cheap substring pre-filter; a file must contain
    - pattern: <string>   #   at least one marker before regex extraction runs
      type: <string>      # informational (`import`, `annotation`, `instantiation`, ...)

endpoint_extraction:
  file_prefix:            # OPTIONAL — see "Class-prefixed routes" below
    regex: <string>
    prefix_group: <int>
    expand_controller_token: <bool>

  patterns:               # one or more per-line regexes; each match is one endpoint
    - regex: <string>
      method_group: <int> # 1-indexed capture group of the HTTP verb;
                          # 0 = no method captured (then default_method MUST be set)
      path_group: <int>   # 1-indexed capture group of the URL path
      default_method:     # OPTIONAL — used when method_group is 0
        <string>
```

The TypeScript types are in [`agents/lib/atlas_inventory.ts`](../agents/lib/atlas_inventory.ts) (`RestProfile`, `endpoint_extraction.patterns`, `file_prefix`).

A few rules the engine enforces:

- **Markers are literal substrings**, not regex. Cheap `String.includes` test before the regex pass — files with no marker are skipped silently. Keep markers tight: an `import` line, a base class, a framework annotation. Avoid markers that might appear in a comment in unrelated files.
- **Patterns are JavaScript regex applied per line.** Capture the method (when present) and the path. Both must be non-empty after capture or the match is dropped.
- **Endpoints are deduplicated by `(file, line, method, path)` across all profiles.** A line matched by two profiles only emits one endpoint; the first profile wins on `framework`. See [What deduplication does](#what-deduplication-does).

## Authoring a profile end to end

The shortest path to a working custom profile:

1. **Pick a representative file** in the target repo — one that you know contains routes the inventory should pick up.
2. **Choose markers.** Read the framework's import statement and pick one or two unique-ish substrings. Wrong markers manifest as silent zero-extraction; check by removing the marker filter temporarily and seeing whether the regex matches.
3. **Write the regex against one or two route lines.** Use [regex101.com](https://regex101.com/) or `node -e` to iterate. Capture the verb in one group and the path in another. For frameworks that omit the verb (path-only routes default to GET), set `method_group: 0` and `default_method: GET` (see [Flask-style](#default-get-routes-flask-style)).
4. **Drop the YAML into `wiki.config.yaml`** under `ecosystem.rest.custom_profiles`. Set `ecosystem.rest.enabled: true` if it isn't already.
5. **Run `atlas_inventory.js generate`** against the repo and inspect the resulting `code-inventory.json` for your endpoints.
6. **Add a vitest fixture.** Even for custom profiles you don't intend to upstream, a tiny `it("extracts X routes", ...)` test in your project's own suite is worth ten minutes — it locks the regex in against framework upgrades.

## Worked examples

### Plain method-on-app routes (Express-style)

The simplest shape. The verb and path are right next to each other on the same line:

```javascript
app.get('/api/users', handler);
app.post("/api/users", handler);
```

Profile:

```yaml
name: express
language: typescript
description: "Express / Node.js HTTP routes"

detection:
  file_patterns:
    - "**/*.ts"
    - "**/*.js"
  markers:
    - { pattern: 'from "express"',  type: import }
    - { pattern: "from 'express'",  type: import }
    - { pattern: "require('express')", type: import }

endpoint_extraction:
  patterns:
    - regex: "(?:app|router|api)\\.(get|post|put|delete|patch|options|head)\\s*\\(\\s*['\"`]([^'\"`]+)['\"`]"
      method_group: 1
      path_group: 2
```

Notes:

- The `(?:app|router|api)` non-capturing group covers common variable names; tweak for your codebase.
- The path's character class `[^'\"\`]+` matches inside any quote style without choking on the closing quote.

### Annotation-attached routes (Spring-style)

The verb is *part of the annotation name* (e.g. `@GetMapping`), and the path is the annotation's first quoted argument — possibly wrapped in `value =` or `path =`:

```java
@GetMapping("/api/users")
@PostMapping(value = "/api/users")
@PatchMapping(path = "/api/users/{id}")
```

Profile (this is the actual shipped Spring matcher):

```yaml
endpoint_extraction:
  patterns:
    - regex: "@(Get|Post|Put|Delete|Patch|Options|Head)Mapping\\s*\\(\\s*(?:(?:value|path)\\s*=\\s*)?[\"']([^\"']+)[\"']"
      method_group: 1
      path_group: 2
```

The `(?:(?:value|path)\\s*=\\s*)?` non-capturing optional handles both bare-arg and named-arg forms.

### Default-GET routes (Flask-style)

When the route declaration carries the path but not an explicit verb (Flask's `@app.route('/x')` defaults to GET if `methods=` is omitted), set `method_group: 0` and use `default_method`:

```python
@app.route("/api/health")
def health(): pass
```

Profile fragment:

```yaml
endpoint_extraction:
  patterns:
    - regex: "@(?:app|bp|blueprint)\\.route\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)"
      method_group: 0
      path_group: 1
      default_method: GET
```

Notes:

- The trailing `\\s*\\)` anchor is what keeps this pattern from also matching the explicit-`methods=` form (`@app.route("/x", methods=...)`) — the closing paren can't sit immediately after the path string when there are more arguments.
- `method_group: 0` is the explicit "no method captured" sentinel. The engine reads `default_method` only in that case.

### Class-prefixed routes (ASP.NET-style)

When routes are scoped by a class-level annotation (ASP.NET's `[Route("api/users")]` above the controller), the per-method path is *relative*:

```csharp
[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase
{
    [HttpGet]                       // → "api/users"
    [HttpGet("{id:int}")]           // → "api/users/{id:int}"
    [HttpDelete("/healthz")]        // → "/healthz"  (absolute path bypasses the prefix)
}
```

Profile (this is the actual shipped ASP.NET matcher):

```yaml
endpoint_extraction:
  file_prefix:
    regex: "\\[Route\\s*\\(\\s*[\"']([^\"']+)[\"']\\s*\\)\\s*\\]"
    prefix_group: 1
    expand_controller_token: true

  patterns:
    - regex: "\\[Http(Get|Post|Put|Delete|Patch|Options|Head)(?:\\s*\\(\\s*[\"']([^\"']+)[\"']\\s*\\))?\\s*\\]"
      method_group: 1
      path_group: 2
```

Behavior:

- `file_prefix.regex` runs once per file (not per line) — the first match's `prefix_group` capture becomes the prefix.
- For each per-line pattern match: paths starting with `/` are absolute and bypass the prefix; empty paths (e.g. `[HttpGet]` with no argument) inherit the prefix as the full path; otherwise the prefix and path are joined with a single `/`.
- `expand_controller_token: true` substitutes `[controller]` in the captured prefix with the controller class name (lowercased, `Controller` suffix stripped). So `[Route("api/[controller]")]` on `class AuthController` resolves to `api/auth`.

If you don't need any of these — straight-line per-method routes with absolute paths — leave `file_prefix` out. The engine ignores it.

## Testing a profile

The shipped profiles are tested in [`agents/lib/tests/atlas_inventory.test.ts`](../agents/lib/tests/atlas_inventory.test.ts). The pattern is the same for any custom profile:

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { detectRestEndpoints, loadRestProfile } from "../atlas_inventory.js";

describe("custom company-rpc profile", () => {
  it("extracts rpc.<verb> routes", () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(
      path.join(tmp, "service.ts"),
      `import { rpc } from "@company/rpc-server";
rpc.get('/api/widgets', listWidgets);
rpc.post('/api/widgets', createWidget);
`,
    );
    const profile = /* loaded from your wiki.config.yaml or inline */;
    const eps = detectRestEndpoints(tmp, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/widgets");
    expect(tuples).toContain("POST /api/widgets");
  });
});
```

For shipped profiles, also add a `loads cleanly from disk` smoke test (mirrors every existing profile's first `it()` block).

## What deduplication does

Endpoints are deduplicated across profiles by `(file, line, method, path)`. The first profile to match a given tuple wins — its `name` is recorded as the endpoint's `framework` field.

This matters when you have overlapping matchers — e.g. both `express` and `hono` markers on the same file (rare but possible in libraries that re-export). The marker-pre-filter keeps non-matching files out, but for files that pass both filters, dedup ensures one endpoint, one framework. If the order matters to you, register your custom profile *before* the shipped one with the same matcher; custom profiles always win on name collision.

The dedup key is intentionally narrow — same file, same line, same method, same path. Two routes on different lines with the same path (rare but legitimate, e.g. a router prefix mounted twice) are kept as distinct endpoints.
