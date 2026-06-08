# Integration Surface Map — doc-wiki

Research for the **cross-service-detection** feature: detect service-to-service relationships
(HTTP clients → REST endpoints, MQ producers/consumers, per-service DB traces) and synthesize
cross-service wiki pages. This document maps every existing pattern the feature must mirror.

All paths are absolute under `/Users/narayan/src/doc-wiki`. Line numbers are at time of writing.

---

## 0. Build / sync / test contract (READ FIRST — landmines)

- **In-place `.ts` → `.js` compilation.** `tsconfig.json` has `"noEmit": false`, `"module": "ESNext"`,
  `"target": "ES2022"`, and **no `outDir`** — `npm run build` (`tsc -b tsconfig.build.json`) emits a
  sibling `foo.js` next to every `foo.ts` under `agents/**` and `skills/**`. Every script is invoked
  as `node <file>.js`. **You must commit BOTH the `.ts` and the regenerated `.js`.**
- **CI enforces sync.** `.github/workflows/ci.yml` (lines 29–34): runs `npm run build`, then
  `git diff --exit-code`; if the built `.js` differs from the committed sibling, CI fails with
  `Built .js files differ from committed siblings`. (Matches MEMORY: `project_doc_wiki_ts_js_sync`.)
- **Tests are excluded from the build** (`tsconfig.build.json` excludes `**/*.test.ts`, `**/tests/**`,
  `**/evals/fixtures/**`). Tests are run by Vitest directly importing the `.js` siblings.
- **Imports use `.js` extensions** even from `.ts` source (ESM/NodeNext), e.g.
  `import { walkCodebase } from "./repo_walker.js";`. Match this exactly.
- **No Python.** All new code is TypeScript.
- Test command for `agents/lib/`: `npx vitest run agents/lib/tests/`. Full suite: `npm test`.
  Typecheck: `npm run typecheck`.

---

## 1. `agents/lib/atlas_inventory.ts` — the inventory manifest emitter

The canonical pre-Phase-2 code-inventory builder. **This is the file the new HTTP-client /
MQ / DB-trace detectors should extend** (new `*Entry[]` buckets + new detector functions +
new profile family, all wired into `generateInventory` / `CodeInventory`).

### 1a. Output types (VERBATIM — new buckets must match this shape)

```ts
export interface ProjectMetadata {
  name: string;
  version: string;
  language: string;   // typescript | python | go | rust | java | unknown
  runtime: string;    // node@20, python@3.11, go@1.22, rust@1.70, ...
  manifests_seen: string[];  // subset of package.json, pyproject.toml, go.mod, Cargo.toml
}

/** One ORM entity discovered in the repo. Mirrors wiki_orm.ExtractedEntity. */
export interface OrmEntityEntry {
  profile: string;
  class_name: string;
  table_name: string;
  schema_name: string;
  source_file: string;                                    // repo-relative POSIX
  columns: Array<{ name: string; source_field: string }>;
  relationships: Array<{ type: string; target_entity: string }>;
}

/** One HTTP endpoint discovered in the repo. */
export interface RestEndpointEntry {
  framework: string;
  method: string;   // uppercase HTTP verb
  path: string;     // URL path as written in source (may include :param)
  file: string;     // repo-relative POSIX
  line: number;     // 1-indexed line of the route declaration
}

/** One callsite of an external-system client (e.g. gather(, fetchWithCaps(). */
export interface CodeClientEntry {
  kind: string;     // gather, fetchWithCaps, ...
  file: string;     // repo-relative POSIX
  line: number;     // 1-indexed
}

export interface InventoryStats {
  files_walked: number;
  files_skipped_for_size: number;
  duration_ms: number;
}

export interface CodeInventory {
  atlas_run_id: string;
  generated_at: string;       // ISO-8601
  repo_root: string;          // path.resolve(repoRoot)
  project_metadata: ProjectMetadata;
  orm_entities: OrmEntityEntry[];
  rest_endpoints: RestEndpointEntry[];
  code_clients: CodeClientEntry[];
  stats: InventoryStats;
  notes: string[];            // free-form per-bucket notes
}
```

> **Extension point #1 (CORE):** Add new buckets to `CodeInventory` — e.g.
> `http_clients: HttpClientEntry[]`, `queue_producers: QueueEntry[]`, `queue_consumers: QueueEntry[]`,
> `service_db_traces: DbTraceEntry[]`. Define `*Entry` interfaces alongside the existing four
> (`atlas_inventory.ts:35-98`). Each `*Entry` MUST carry `{ file: string; line: number }` and a
> repo-relative POSIX path (use `_toRepoRelative`, line 751). Mirror `RestEndpointEntry` /
> `CodeClientEntry` exactly so the gap-report and synthesis consumers can treat them uniformly.

### 1b. REST-profile system (the template for new profile families)

**Profile schema type** (`atlas_inventory.ts:290-323`, VERBATIM):

```ts
export interface RestProfile {
  name: string;
  language: string;
  description?: string;
  detection: {
    file_patterns: string[];                       // globs for walkCodebase
    markers: Array<{ pattern: string; type?: string }>;  // literal substrings (NOT regex)
  };
  endpoint_extraction: {
    file_prefix?: {                                // optional class-level path prefix
      regex: string;
      prefix_group: number;
      expand_controller_token?: boolean;          // ASP.NET [controller] expansion
    };
    patterns: Array<{
      regex: string;                              // full regex, applied PER LINE
      method_group: number;                       // 1-indexed; 0 => use default_method
      path_group: number;                         // 1-indexed
      default_method?: string;                    // required when method_group is 0
    }>;
  };
}
```

**Discovery / load / validate functions:**

- `_restProfilesDir()` (l.325) → `path.dirname(fileURLToPath(import.meta.url)) + "/rest_profiles"`.
  i.e. the loader looks for YAMLs **next to the built `.js`**, in `agents/lib/rest_profiles/`.
- `discoverShippedRestProfiles(): string[]` (l.337) — reads every `*.yaml` in that dir, strips
  `.yaml`, returns sorted basenames. 18 profiles ship today.
- `_validateRestProfile(parsed): RestProfile | null` (l.361) — requires `name`+`language` strings
  and non-null `detection`+`endpoint_extraction`; returns `null` on failure (silent skip).
- `loadRestProfile(name): RestProfile | null` (l.383) — reads `<dir>/<name>.yaml`, `yaml.load`,
  validates. All errors silenced → `null`.
- `loadCustomRestProfiles(wikiConfigPath): RestProfile[]` (l.413) — reads
  `ecosystem.rest.custom_profiles` from `wiki.config.yaml`; validates each entry. Lets users add
  in-house frameworks with zero code changes.
- `resolveRestProfiles({ profileNames?, wikiConfigPath? }): RestProfile[]` (l.456) — custom profiles
  loaded FIRST (so they override shipped names on collision via a `seen` Set), then shipped. Empty
  `profileNames` ⇒ all shipped + all custom.

**`detectRestEndpoints(repoRoot, profiles): RestEndpointEntry[]`** (l.500-571) — the three-stage matcher,
the exact algorithm new detectors should copy:

1. **Walk:** `walkCodebase(repoRoot, profile.detection.file_patterns)` → `{absPath: content}`.
2. **Marker pre-filter** (cheap): skip a file unless `content.includes(marker.pattern)` for at least
   one marker. Markers are **literal substrings**, NOT regex.
3. **Per-line regex extraction:** split into lines; for each `endpoint_extraction.patterns` entry,
   `new RegExp(ext.regex, "g")` and scan each line. `method = ext.method_group>0 ? m[method_group].toUpperCase() : ext.default_method.toUpperCase()`. `path = _resolvePath(m[path_group], filePrefix)`.
4. **Dedup key:** `` `${relFile}|${lineIdx+1}|${method}|${apiPath}` `` in a `seen` Set; first
   profile to match a tuple wins (its `name` becomes `framework`).
5. `_extractFilePrefix` (l.764) runs the optional `file_prefix` regex once per file;
   `_resolvePath` (l.795) prepends prefix unless the path is absolute (`startsWith("/")`).

> **Extension point #2 (CORE — new profile families):** Mirror this whole sub-system for
> **HTTP-client profiles** and **MQ profiles**. Recommended: a new `agents/lib/client_profiles/*.yaml`
> dir + `ClientProfile` interface + `loadClientProfile` / `discoverShippedClientProfiles` /
> `resolveClientProfiles` / `detectHttpClients`. Keep `markers` literal, `patterns` per-line regex,
> the `(file,line,...)` dedup key, and the silent-skip-on-bad-YAML contract. **Reuse `walkCodebase`
> verbatim** (do not write a new walker). REST and client profiles can coexist in two dirs, OR you can
> add a `kind`/`category` discriminator to one shared profile dir — but two dirs matches the existing
> "one profile family per concern" grain (`rest_profiles/` vs `wiki_orm/profiles/`).

### 1c. `code_clients` detector (the closest existing analogue to HTTP-client detection)

`detectCodeClients(repoRoot): CodeClientEntry[]` (l.598-614). Currently **hard-codes** two client
primitives, NOT profile-driven:

```ts
const _CLIENT_PATTERNS = [
  { kind: "gather",        regex: /\bgather\s*\(/ },
  { kind: "fetchWithCaps", regex: /\bfetchWithCaps\s*\(/ },
];
const _CLIENT_FILE_PATTERNS = [
  "**/*.ts","**/*.tsx","**/*.js","**/*.jsx","**/*.mjs","**/*.cjs","**/*.py",
];
```

Algorithm: `walkCodebase(repoRoot, _CLIENT_FILE_PATTERNS)`, then per-line `regex.test(line)` → push
`{ kind, file: relFile, line }`. No marker pre-filter, no dedup.

> **Note for the implementer:** This is the simplest detector and a good model for a minimal
> first cut, BUT it is hard-coded. For real HTTP-client → endpoint correlation you'll want the
> richer profile-driven approach (1b) so you can capture the *target URL/host* and *method* from the
> client call (e.g. `axios.get('http://users-svc/...')`, `fetch(\`${USERS_BASE}/x\`)`,
> `httpClient.post(...)`), not just the callsite. A `HttpClientEntry` should carry at least
> `{ kind, method?, target_url_or_host?, file, line }` to be joinable against `RestEndpointEntry`.

### 1d. `generateInventory` wiring + write path

- `generateInventory(repoRoot, runId, options): CodeInventory` (l.642-689). Pure (no disk writes).
  Calls each detector, gated by `GenerateOptions`:
  - `enableOrm?` (default true), `enableRest?` (default **false** — opt-in),
    `restProfiles?: string[]`, `wikiConfigPath?`.
  - `stats.files_walked` is approximated as the union of touched files across buckets.
- `inventoryPath(wikiRoot, runId)` (l.692) → **`<wikiRoot>/outputs/atlas/<runId>/code-inventory.json`**.
  (Note: the SKILL.md prose says `wiki/outputs/...` but the code writes to `<wikiRoot>/outputs/...`;
  the wiki root passed in already points at the wiki dir.)
- `persistInventory(wikiRoot, inv): string` (l.700) — mkdir -p + `JSON.stringify(inv, null, 2)+"\n"`.
- `loadInventory(wikiRoot, runId): CodeInventory | null` (l.715) — null on missing / malformed /
  `atlas_run_id` mismatch / any of the four required arrays missing. **If you add new buckets,
  decide whether `loadInventory`'s shape-check should require them** (it currently checks
  `project_metadata`, `orm_entities`, `rest_endpoints`, `code_clients`). For backward-compat with
  old manifests, treat new buckets as optional in the load check (default to `[]`).

### 1e. CLI entrypoint structure (mirror this for any new CLI)

`atlas_inventory.ts:835-971`:
- `FLAG_SPEC` maps `--wiki-root`→`wikiRoot`, `--repo-root`→`repoRoot`, `--run-id`→`runId`,
  `--rest-profile`/`--rest-profiles`.
- One subcommand: `generate`. Bare flag `--enable-rest` is detected via `argv.includes(...)` and
  filtered out **before** `parseFlags` (because `parseFlags` is a `--flag value` parser).
- `parseFlags(args, FLAG_SPEC)` from `skills/doc-wiki/scripts/_cli_args.js` is the shared parser.
- `_RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/` validates the run id.
- `_readEcosystemRestEnabled(wikiRoot)` (l.808) reads `ecosystem.rest.enabled` from
  `wiki.config.yaml` (or `wiki/wiki.config.yaml`); CLI flag wins over config.
- Stdout: `JSON.stringify({ ...inventory, written: target })`.
- Self-exec guard (l.968): `if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) process.exit(main());`

---

## 2. REST-profile YAML schema (VERBATIM — new profile YAMLs must mirror these)

Loaded by `loadRestProfile` (§1b). Keys consumed: `name`, `language`, `description` (optional),
`detection.file_patterns`, `detection.markers[].pattern` (+ optional `.type`, ignored at runtime),
`endpoint_extraction.file_prefix` (optional), `endpoint_extraction.patterns[].{regex, method_group,
path_group, default_method?}`.

### `agents/lib/rest_profiles/express.yaml` (full)

```yaml
name: express
language: typescript
description: "Express / Node.js HTTP routes"

detection:
  file_patterns:
    - "**/*.ts"
    - "**/*.tsx"
    - "**/*.js"
    - "**/*.jsx"
    - "**/*.mjs"
    - "**/*.cjs"
  markers:
    - pattern: "from \"express\""
      type: import
    - pattern: "from 'express'"
      type: import
    - pattern: "require('express')"
      type: import
    - pattern: "require(\"express\")"
      type: import

# Each pattern is a JavaScript-flavour regex applied PER LINE so the
# captured line number is meaningful. method_group / path_group are
# 1-indexed offsets into the regex's capture groups.
endpoint_extraction:
  patterns:
    # app.get('/path', ...), router.post("/path"), api.put(`/x/:id`)
    - regex: "(?:app|router|api)\\.(get|post|put|delete|patch|options|head)\\s*\\(\\s*['\"`]([^'\"`]+)['\"`]"
      method_group: 1
      path_group: 2
    # express.Router().get('/path', ...)
    - regex: "Router\\(\\)\\.(get|post|put|delete|patch|options|head)\\s*\\(\\s*['\"`]([^'\"`]+)['\"`]"
      method_group: 1
      path_group: 2
```

### `agents/lib/rest_profiles/spring.yaml` (full)

```yaml
name: spring
language: java
description: "Spring (Java/Kotlin) MVC + WebFlux HTTP routes"

detection:
  file_patterns:
    - "**/*.java"
    - "**/*.kt"
  markers:
    - pattern: "import org.springframework"
      type: import
    - pattern: "@RestController"
      type: annotation
    - pattern: "@Controller"
      type: annotation

# Per-line regex extraction. Captures the HTTP verb from the annotation
# name (Get/Post/...) and the path from the first quoted string argument.
# The method name is uppercased downstream.
endpoint_extraction:
  patterns:
    # @GetMapping("/path"), @PostMapping(value = "/path"), @PatchMapping(path = "/x")
    - regex: "@(Get|Post|Put|Delete|Patch|Options|Head)Mapping\\s*\\(\\s*(?:(?:value|path)\\s*=\\s*)?[\"']([^\"']+)[\"']"
      method_group: 1
      path_group: 2
```

Key facts for authoring new YAMLs:
- `markers` are matched by `content.includes(...)` — **literal substrings**, not regex. Escape
  nothing; write exactly what appears in source (`from "express"` with the quote).
- `endpoint_extraction.patterns[].regex` is a **string** that `new RegExp(regex, "g")` compiles, run
  **per line**. Backslashes must be YAML-escaped (`\\(`, `\\s`). Capture group offsets are 1-indexed.
- `file_prefix` (see `aspnet.yaml` for the live example referenced in code) handles class-level
  route prefixes with optional `[controller]` token expansion.
- A bad regex is silently skipped by `detectRestEndpoints` (`try { new RegExp } catch { continue }`),
  unlike ORM profiles which validate at load (see §7 landmine).

---

## 3. `agents/lib/atlas_synthesize.ts` — synthesis-input assembler

Read-only input assembly for atlas **Phase 7 globals**. Each global page has its own
`assembleXInputs(...) → SynthesisBundle` and a CLI subcommand. **This is where new cross-service
synthesis pages (service-map, dependency-graph, client-registry, queue-registry) plug in.**

### 3a. `SynthesisBundle` (l.42-49, VERBATIM)

```ts
export interface SynthesisBundle {
  sources: string[];   // wiki- or repo-relative paths that contributed
  text: string;        // concatenated text handed to the LLM synthesis step
  notes: string[];     // per-bundle notes (e.g. "no api.md pages for topic X")
}
```

### 3b. Existing subcommands + CLI dispatch

Seven subcommands (l.886-979): `overview`, `integrations`, `deploy`, `commands`, `configuration`,
`getting-started`, `troubleshooting`. CLI shape mirrors atlas_inventory: `parseFlags` with
`FLAG_SPEC = { --wiki-root, --repo-root, --connectors-config }`; each prints
`JSON.stringify(bundle)`. Subcommands split into wiki-root-driven (`overview`/`integrations`/
`troubleshooting`) vs repo-root-driven (`deploy`/`commands`/`configuration`/`getting-started`,
default repoRoot = cwd).

### 3c. `_findAtlasPages(wikiRoot, wantedFacets?)` (l.67-113)

Walks `<wikiRoot>/wiki/` (skips `_`-prefixed dirs), parses frontmatter via `parseFrontmatter`
(`skills/doc-wiki/scripts/_frontmatter.js`), keeps pages whose frontmatter `atlas_facet` is in
`wantedFacets` (or all if undefined). Returns `AtlasPageMatch[] = { page (wiki-relative), facet,
body, frontmatter }`, sorted by page path. **This is the per-topic page locator by facet** — a
service-map synthesis would call `_findAtlasPages(wikiRoot, ["architecture", "api"])` to pull
per-service architecture + api pages.

Helpers: `_extractTldr(body)` (l.120) pulls the `## TL;DR` section; `_inferAudience(facet, fm)`
(l.133) maps facet→audience (extend its `switch` if you add new facets).

### 3d. `assembleIntegrationsInputs` (l.253-309) — the integration-detection heuristic to mirror

Scans `api`-facet pages (full body) + `architecture`-facet pages for lines containing an
**integration keyword**, then inlines the connector config file.

```ts
function _getIntegrationKeywords(): string[] {
  const fromRegistry = builtinConnectorIds().filter((id) => id !== "db");  // source_registry.ts
  return [...new Set([...fromRegistry, ..._COMMON_SAAS_KEYWORDS])];        // +stripe,datadog,sentry,...
}
```

Per `architecture` page: split body to lines, lowercase, push any line containing a keyword as an
"external-mention" hit. Connector config resolved from `--connectors-config` or
`_defaultConnectorConfigPaths()` (`./.connectors/config.yaml`, `~/.connectors/config.yaml`).

> **The new cross-service synthesizers would do the analogous thing but read the MANIFEST, not page
> text.** A service-map / dependency-graph assembler should `loadInventory(wikiRoot, runId)` and join
> `http_clients` (target host/url) against `rest_endpoints` (path) to build the edge list, then emit a
> `SynthesisBundle` whose `text` is a Mermaid seed + a per-service table. See `groupManifestByTopicFacet`
> (§3f) and `_commandsLifecycleSeed` (§3g) for the two relevant existing patterns.

### 3e. Repo-target bundle pattern (`deploy`, `configuration`)

`assembleDeployInputs` / `assembleConfigurationInputs` (l.377, 653) call `walkRepoTargets`
(repo_walker, §5) with `{ topLevelBasenames: RegExp[], subdirPatterns: {dir,rx}[] }`, then
`_readAndFormatBundleFiles(repoRoot, paths, notes)` (l.345) reads + truncates at 200 KB + fences each
as `## <rel>`. Use this when a new synthesis page needs raw repo files (e.g. a queue-config registry
scanning `**/*.yaml` for broker config).

### 3f. `groupManifestByTopicFacet(inventory, topics)` (l.842-876) — manifest→topic mapping

THE pattern for assigning manifest entries to per-service topics. Returns
`{ [topic]: { "data-model": string[], "api": string[] } }`. Topic assignment is **path-based** via
`extractTopicFromPath(sourceFile)` (l.818) which looks for `<prefix>/<topic>/...` where `prefix ∈
{src, app, apps, services, lib, internal, pkg, packages, modules, cmd}` (`_TOPIC_DIR_PREFIXES`,
l.787) and canonicalizes (`_canonicalizeTopic`: kebab-case, strip `-service|-svc|-module`).

> **Extension point #3:** For per-service DB traces and per-service client lists, add a sibling
> grouping fn (e.g. `groupServiceArtifacts(inventory, topics)`) returning
> `{ [service]: { clients: HttpClientEntry[], db_traces: DbTraceEntry[], ... } }`, reusing
> `extractTopicFromPath`. The `services/` prefix is already first-class here — this is the
> microservices-positioning USP path (root-repo + submodule pattern; see MEMORY
> `feedback_microservices_positioning`).

### 3g. Mermaid seed pattern (`_commandsLifecycleSeed`, l.428-455)

Builds a `flowchart TD` from `PhaseNode[]`/`PhaseEdge[]`/`ClassDef[]` via
`formatPhaseFlow(...)` from `mermaid_format.js`, wraps it in
`<!-- mermaid-seed: ... -->` / `<!-- /mermaid-seed -->` markers and a ```mermaid fence. Idempotent.
**This is exactly how a service-dependency-graph page should emit its diagram** — produce the node/edge
lists from the joined manifest and call `formatPhaseFlow`, then prepend the fenced seed to the bundle
text so the LLM preserves the topology verbatim.

> **Extension point #4 (CORE — new synthesis subcommands):** To add e.g. `service-map`:
> 1. Write `export function assembleServiceMapInputs(wikiRoot): SynthesisBundle` (load inventory, join
>    clients↔endpoints, build Mermaid seed + table). 2. Add the subcommand to `HELP_TEXT` (l.886) and
>    the `main` dispatch (l.934-976). 3. Add the facet to `_inferAudience` (l.133) and to the
>    `STATIC_GLOBAL_PAGES` list in `atlas_orchestrator.ts` (l.301) so cost estimation counts it.
>    4. Add the page to SKILL.md Phase 7 (§6).

---

## 4. Edge graph — `skills/doc-wiki/scripts/graph_ops.ts` + `graph/edges.jsonl`

### 4a. Edge record format (VERBATIM, l.49-72)

```ts
export const VALID_EDGE_TYPES: ReadonlySet<string> = new Set([
  "supports", "contradicts", "extends", "supersedes",
]);
export const VALID_PROVENANCE: ReadonlySet<string> = new Set([
  "EXTRACTED", "INFERRED", "AMBIGUOUS",
]);

export type Edge = Record<string, unknown> & {
  from: string;
  to: string;
  type: string;         // must be one of VALID_EDGE_TYPES
  provenance: string;   // must be one of VALID_PROVENANCE
  evidence?: string;
  source_file?: string;
  date?: string;        // YYYY-MM-DD, local tz, auto-filled
};
```

- **`from`/`to` are wiki page paths** (e.g. `auth/architecture.md`), NOT arbitrary node ids. Edges
  whose endpoint is under a `_`-prefixed dir are filtered out of all queries (`isExcludedNode`, l.37).
- The edge type vocabulary is the four claim-relationship verbs only. **A service-dependency edge
  ("service A calls service B") does not fit `supports/contradicts/extends/supersedes`.** Decide:
  either (a) map a cross-service dependency to `extends`/`supports` with `evidence` describing the
  call (cheapest, reuses the graph), or (b) extend `VALID_EDGE_TYPES` with e.g. `depends_on` /
  `produces` / `consumes` (requires touching `graph_ops.ts` + its tests + any consumer that switches
  on edge type). **Flag this design choice to the user** — it's the one genuinely new vocabulary
  decision. If you extend the set, also update `references/operations.md` and the lint/quality checks
  that may enumerate edge types.

### 4b. Read/write location + helpers

- **Lives at `<wikiRoot>/graph/edges.jsonl`.** Scaffolded by `init_wiki.ts` (l.527, creates empty
  file; config key `graph.edges_file: "graph/edges.jsonl"`, l.338). `graph/` is in `SCAFFOLD_DIRS`.
- **The ONLY edge-writing helper is `addEdge`** (`graph_ops.ts:124-158`):
  ```ts
  addEdge(edgesPath, fromPage, toPage, edgeType, provenance, evidence="", sourceFile="")
  ```
  Validates type+provenance (throws on invalid), stamps `date: todayIso()`, **appends** one JSON line
  via `fs.appendFileSync`. Returns the edge. `removeEdge(edgesPath, from, to, type)` (l.174) rewrites
  the file. There is **no batch-add**; loop `addEdge` for multiple edges, or write JSONL lines directly
  in the same `{from,to,type,provenance,evidence,source_file,date}` shape (see `writeAllEdges`, l.100).
- Grep confirms edges are read/written ONLY in `graph_ops.ts`; `quality_score.ts`, `lint_checks.ts`,
  `init_wiki.ts` reference the path/config but do not author edges. New code should call `addEdge`.

### 4c. Graph query API (signatures)

```ts
addEdge(edgesPath, from, to, type, provenance, evidence?, sourceFile?): Edge
removeEdge(edgesPath, from, to, type): boolean
listEdges(edgesPath, edgeType?): Edge[]              // excluded edges dropped
computeDegrees(edgesPath): Record<string, number>    // in+out degree per node
godNodes(edgesPath, topN=10, excludeTypes?): Array<[string, number]>
isolatedNodes(edgesPath, allPages): string[]         // degree <= 1
clusters(edgesPath, allPages?): string[][]           // weakly-connected components (union-find)
shortestPath(edgesPath, from, to, maxHops=6, via?): Edge[]   // graphology bidirectional
allPaths(edgesPath, from, to, maxPaths=5): Edge[][]          // simple directed paths (DFS)
```

CLI subcommands: `add`, `path` (+`--all-paths`, `--via`, `--max-hops`), `degrees`, `god-nodes`.
Path finding uses `graphology` + `graphology-shortest-path/unweighted`. Determinism depends on
node-insertion order (TRIP WIRE comment at l.343).

> **Extension point #5:** A "dependency graph" cross-service page can either (a) write
> service→service edges into `edges.jsonl` via `addEdge` and then render with `shortestPath`/`clusters`,
> or (b) keep service edges in the manifest only and render Mermaid directly (§3g). Given the
> edge-type-vocabulary mismatch (§4a), **(b) is lower-friction** unless service dependencies are wanted
> in `/doc-wiki:query --from <a> --to <b>` path queries.

---

## 5. `agents/lib/repo_walker.ts` — bounded source walker (REUSE, do not reinvent)

- `walkCodebase(root, patterns: string[], opts?): Record<string,string>` (l.137) — iterative DFS,
  returns `{absPath: contents}` for files matching any glob. Honors `DEFAULT_IGNORE`, `MAX_FILES=2000`,
  and `.gitignore` (nested, scoped; default on; `opts.respectGitignore:false` to disable). Unreadable
  files silently skipped. **This is what every detector uses** (ORM, REST, code-clients all call it).
- `DEFAULT_IGNORE` (l.67): `node_modules, .git, .venv, venv, __pycache__, dist, build, target, .next,
  .gradle, .idea, .worktrees, wiki-workspace`.
- `compileGlob(pattern)` (l.96) / `matchesPattern(path, patterns)` (l.111, cached) — supports `*`
  (single segment), `**` (any), `**/` (zero-or-more dirs). `*.ts` matches `src/x.ts` not `src/x.tsx`.
- `walkRepoTargets(repoRoot, spec, opts?): { paths: string[]; notes: string[] }` (l.241) — the
  basename/subdir variant used by synthesis bundles (§3e). Returns sorted repo-relative POSIX paths,
  does NOT read bodies.

> **Extension point #6:** New detectors call `walkCodebase(repoRoot, profile.detection.file_patterns)`
> exactly like `detectRestEndpoints`. Do not add a new walker or new ignore-list.

---

## 6. Atlas phase flow — where detection and synthesis slot in

Source: `skills/doc-wiki/SKILL.md` §`/doc-wiki:atlas` (l.229-347), `commands/atlas.md`,
`atlas_orchestrator.ts`. The pipeline is **8 phases** (numbered 1, 1b, 2–8):

| Phase | What it does | Relevant to new feature |
|---|---|---|
| **1 — Detect state** | `atlas_orchestrator.js detect-state`; mint `atlas_run_id` (`YYYY-MM-DDTHH-MM-SS`). | run id reused by all artifacts |
| **1b — Inventory** | `node agents/lib/atlas_inventory.js generate --wiki-root <r> --repo-root <r> --run-id <id>` → `outputs/atlas/<id>/code-inventory.json`. | **← NEW DETECTORS RUN HERE.** New buckets are emitted here. |
| **2 — Discover topics** | Union 5 signals (code dirs incl. `services/`, ORM domains, wiki dirs, gitlog, tooling commands). Canonicalize topics. | services become topics |
| **3 — Confirm topics** | Present merged list (autonomy-gated). | — |
| **4 — Estimate cost** | Build `Plan`; `compute-sources` (manifest-backed `data-model`+`api`); `estimate-cost`. | new globals must be in `STATIC_GLOBAL_PAGES` |
| **5 — Validate existing** | structural + gitlog drift + semantic; drift-report.md. | — |
| **5b — Archive sweep** | move pages whose sources were deleted into `wiki/_archive/`. | — |
| **6 — Bootstrap/refresh** | per plan entry: `wiki-orm-agent` for data-model, else `/doc-wiki:ingest --output`. | per-service pages produced here |
| **7 — Synthesize globals** | **7 global pages** via `atlas_synthesize.js <sub>`. | **← NEW CROSS-SERVICE PAGES SLOT IN HERE** (service-map, dependency-graph, client-registry, queue-registry) |
| **8 — Finalize** | lint, **gap-report** (consumes inventory: `endpointsWithoutDocumentation`, `clientsWithoutDocumentation`), index, crosslink, root-file agents, cost-report. | gap-report should gain `clientsWithoutDocumentation`-style fields for new buckets |

**Gap report consumer** (`atlas_orchestrator.ts:563-714, assembleGapReport`): already cross-checks
`inventory.rest_endpoints` and `inventory.code_clients` against atlas pages' frontmatter `sources:`
and emits `endpointsWithoutDocumentation` / `clientsWithoutDocumentation`. New buckets should get the
same treatment (add `*WithoutDocumentation` fields + render in `renderGapReportMarkdown`, l.717).

**Artifact paths (all under `<wikiRoot>/outputs/atlas/<runId>/`):** `code-inventory.json`,
`plan-snapshot.json`, `drift-report.md`, `gap-report.md`, `cost-report.md`.

**Cost-estimation hook for new globals** (`atlas_orchestrator.ts:301-322`):
`STATIC_GLOBAL_PAGES` (currently 7) drives `expectedGlobalCount` × `GLOBAL_PAGE_AVG_USD` (0.20).
Add each new cross-service page slug here so Phase 4 estimates correctly.

---

## 7. `agents/lib/wiki_orm/` + `agents/wiki-orm-agent/` — ORM mapping (per-service DB traces)

### 7a. Structure
- `agents/lib/wiki_orm/`: `profiles.ts` (loader), `extractor.ts` (regex entity/relationship
  extraction), `output.ts` (Mermaid erDiagram + markdown), `db_provider.ts` / `wiki_db_provider.ts`
  (live-DB cross-validation), `serena.ts`, `index.ts`. Profiles: `profiles/*.yaml` — 7 profiles
  (activerecord, django, entity_framework, jpa, prisma, sqlalchemy, typeorm).
- `agents/wiki-orm-agent/`: `AGENT.md`, `scripts/orm_detect.ts` (CLI shim), `evals/`.

### 7b. Output shape (entity→table + relationships)

`ExtractedEntity` (`extractor.ts:44-51`):
```ts
{ class_name, table_name, schema_name, columns: ExtractedColumn[], relationships: ExtractedRelationship[], source_file }
ExtractedColumn       = { name, source_field }
ExtractedRelationship = { type, target_entity, source_line, through_table? }
//   type ∈ one_to_many | many_to_one | many_to_many | one_to_one | relationship | foreign_key
```
`extractEntities(fileContents, profile): ExtractedEntity[]` (l.104) windows each class region and
applies `class_pattern`/`table_pattern`/`column_pattern`/`relationship_patterns`.

**ORM profile YAML** (different keys from REST profiles — `OrmProfile`, `profiles.ts:39-50`):
`detection.{file_patterns, markers}`, `entity_extraction.{class_pattern, table_pattern,
column_pattern}`, `relationship_detection.patterns[]`, `naming_conventions`. Required top-level keys
(`REQUIRED_FIELDS`, l.21): `name, language, detection, entity_extraction`. See `jpa.yaml` for the
canonical example.

### 7c. Can per-service DB traces reuse this? YES, statically.

- `detectOrmEntities(repoRoot)` in atlas_inventory (l.244) **already** runs the ORM extractor and
  emits `orm_entities` with `source_file`. To produce **per-service DB traces**, group those entities
  by service via `extractTopicFromPath` (§3f) — `services/users/.../User.java` → service `users`,
  table `users`. **No new extraction needed**; it's a grouping + synthesis layer over the existing
  `orm_entities` bucket. This is purely static JPA/SQLAlchemy/etc. parsing — exactly what we want.
- **`executeReadAsync` / `adaptDriver` / `getConnection` async contract is NOT relevant** to static
  DB-trace detection. Those govern the *live-DB cross-validation* path (`crossValidate`,
  `extractor.ts:435`; the `wiki_db` library; the architecture contracts in CLAUDE.md). Static
  entity→table mapping from source code never touches a live DB. **Flag:** only invoke the async
  driver path if the feature also wants to verify traces against a running database — and that path
  is opt-in (`ecosystem.orm.cross_validate_against_db` + `--env`), NEVER throws, and must be `await`ed.
  For static cross-service detection, skip it entirely.

---

## 8. Testing conventions (what a new module needs)

Reference: `agents/lib/tests/atlas_inventory.test.ts`, `agents/lib/tests/fixtures.ts`.

- **Framework:** Vitest. `import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";`
- **Test file location:** `agents/lib/tests/<module>.test.ts` (co-located sibling dir, NOT next to
  the source). For wiki-orm-agent–style CLIs: `agents/wiki-orm-agent/scripts/tests/`. For
  skill scripts: `skills/doc-wiki/scripts/tests/`.
- **Imports point at the built `.js`:** `from "../atlas_inventory.js"` (NOT `.ts`).
- **Shared fixtures** (`agents/lib/tests/fixtures.ts`): `makeTmpPath(prefix)` (mkdtemp),
  `cleanupTmpPath(p)`, `writeConfigYaml(tmpPath, config, filename?)`, `SCRIPTS_DIR`. Standard pattern:
  `beforeEach` → `makeTmpPath`, write fixture files into it, run detector, assert; `afterEach` →
  `cleanupTmpPath`. Detector tests write tmp source files (e.g. `models/user.py`, `src/routes.ts`)
  and assert on the returned entries.
- **Profile-YAML fixtures:** new shipped profiles live in `agents/lib/<family>_profiles/*.yaml` and
  are tested via `loadXProfile("name")` against the real shipped file (see the
  `loadRestProfile("express")` test, l.230) — no fixture copy needed for shipped profiles. For custom
  profiles, write a `wiki.config.yaml` via `writeConfigYaml` and assert `loadCustomXProfiles`.
- **Build sibling requirement (CRITICAL):** after adding/editing any `.ts`, run `npm run build` and
  **commit the generated `.js` sibling alongside the `.ts`**, or CI's `git diff --exit-code` fails
  (§0). New profile YAMLs are data — no build needed for them, but they must be `git add`ed.
- Run: `npx vitest run agents/lib/tests/`; typecheck `npm run typecheck`; full `npm test`.
- Current baseline: 1130 passed / 5 skipped (live-DB integration, gated behind `TEST_LIVE_*`).

---

## 9. Concrete extension-point checklist (file → how)

1. **`agents/lib/atlas_inventory.ts`** — add `HttpClientEntry`/`QueueEntry`/`DbTraceEntry` interfaces
   + fields on `CodeInventory`; add `detectHttpClients`/`detectQueueX` detectors (copy the
   `detectRestEndpoints` 3-stage matcher or, minimally, the `detectCodeClients` per-line scan); wire
   into `generateInventory`; relax `loadInventory`'s shape check to treat new buckets as optional.
2. **New `agents/lib/client_profiles/*.yaml`** (+ a `ClientProfile` loader mirroring §1b) — for
   HTTP-client and MQ matching. Same YAML grain as `rest_profiles/` (literal `markers`, per-line regex
   `patterns`). Reuse `walkCodebase`.
3. **`agents/lib/atlas_synthesize.ts`** — add `assembleServiceMapInputs` / `assembleDependencyGraphInputs`
   / `assembleClientRegistryInputs` / `assembleQueueRegistryInputs` (each returns `SynthesisBundle`,
   loads the manifest, joins clients↔endpoints, emits a `formatPhaseFlow` Mermaid seed); add
   subcommands to `main` + `HELP_TEXT`; extend `_inferAudience`; add a `groupServiceArtifacts` helper
   modeled on `groupManifestByTopicFacet`.
4. **`skills/doc-wiki/scripts/atlas_orchestrator.ts`** — add the new page slugs to
   `STATIC_GLOBAL_PAGES` (l.301) so Phase-4 cost estimation counts them; add
   `*WithoutDocumentation` fields to `GapReport` + `assembleGapReport` + `renderGapReportMarkdown`.
5. **`skills/doc-wiki/SKILL.md`** — document the new buckets in Phase 1b prose (l.264) and add the new
   cross-service pages to the Phase 7 global list (l.305-312) with their `audience`.
6. **(Decision) `skills/doc-wiki/scripts/graph_ops.ts`** — only if service→service edges go into
   `edges.jsonl`: either reuse an existing edge type or extend `VALID_EDGE_TYPES` (touches tests +
   docs). Default recommendation: render the dependency graph from the manifest via Mermaid (§4c),
   skip the edge graph unless path queries over services are required.

## 10. Landmines to respect

- **`.ts`/`.js` sync** (§0) — build + commit both; CI `git diff --exit-code` is unforgiving.
- **Manifest write path** is `<wikiRoot>/outputs/atlas/<runId>/code-inventory.json` (NOT
  `wiki/outputs/...`; the wiki root already points at the wiki dir). Run id regex:
  `^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$`.
- **Markers are literal substrings, patterns are per-line regex** — do not mix them up. REST-profile
  bad regex is silently skipped; **ORM-profile** bad regex throws `ProfileValueError` at load
  (`profiles.ts:_validateProfileRegexes`, l.212) — if you add a load-time validator for a new profile
  family, decide which behavior you want and keep it consistent.
- **Edge type vocabulary** is fixed at 4 verbs; service-dependency doesn't fit cleanly (§4a) — surface
  this design choice.
- **Async DB driver contract** (`executeReadAsync`, `await getConnection`, `adaptDriver`) is ONLY for
  live-DB cross-validation, which `crossValidate` never throws from and is opt-in. Static per-service
  DB-trace detection reuses the existing `orm_entities` bucket and touches none of it.
- **`detectRestEndpoints` opt-in:** REST detection defaults OFF (`ecosystem.rest.enabled`,
  `--enable-rest`). Decide whether new client/MQ detection should default on or follow the same
  opt-in flag (recommend opt-in, mirroring REST, with an `ecosystem.<family>.enabled` flag read the
  same way as `_readEcosystemRestEnabled`, l.808).
- **Reuse `walkCodebase` and `extractTopicFromPath`** — do not write new walkers or topic parsers.
- **`services/` is already a first-class topic prefix** (`_TOPIC_DIR_PREFIXES`, atlas_synthesize l.787;
  topic discovery in SKILL.md Phase 2) — the microservices USP path is already wired for topic
  grouping; the feature builds the cross-service *join* on top.
