# B7 Connector Reuse Contract

**Task:** B7 — static per-service external-dependency detection + narai-primitives connector cross-reference  
**Date:** 2026-06-07  
**Purpose:** Exact API surface B7 must reuse rather than re-implement.

---

## Capability (a): Classify an external source string → connector id

### Function: `lookupBySource`

**Import path:** `./source_registry.js` (TS source: `agents/lib/source_registry.ts`)

**Signature:**
```ts
export function lookupBySource(source: string): AgentManifest | null
```

**What it takes:** Any string — either an `https://` URL or a scheme-prefixed URI (`jira://`, `db://`, etc.).

**What it returns:** `AgentManifest | null`. The relevant field for B7 is `manifest.name` (e.g. `"wiki-github-agent"`) or the short id extracted as `name.replace(/^wiki-/, "").replace(/-agent$/, "")`. Returns `null` for no match.

**Matching logic (to verify coverage):**
1. `https://` URLs → matched against `source_url_patterns` (hostname glob + optional `path_prefix` / `path_contains`).
2. Any other `<scheme>://` string → matched against `source_schemes`.

**Registry must be initialized first:**
```ts
import { initRegistry, lookupBySource } from "./source_registry.js";
initRegistry();                            // idempotent; clears + reloads builtins
const manifest = lookupBySource("https://github.com/org/repo");
const connectorId = manifest?.name.replace(/^wiki-/, "").replace(/-agent$/, "");
// → "github"
```

Custom agents from `wiki.config.yaml`'s `ecosystem.agents.custom` can be passed via `initRegistry({ customAgents: [...] })`.

### DB connection string gap (critical)

The `db` connector registers **only** `"db://"` as its scheme. Standard JDBC/driver connection strings (`jdbc:postgresql://`, `postgresql://`, `mongodb://`, `mysql://`) are **NOT** registered and will return `null` from `lookupBySource`.

**B7 must add its own DB-URL → `db` connector mapping.** The cleanest place is a thin helper in the new B7 script (not in `source_registry.ts`):

```ts
const DB_SCHEMES = [
  "jdbc:", "postgresql://", "postgres://", "mysql://",
  "mongodb://", "mongodb+srv://", "sqlite://", "redis://",
  "mssql://", "sqlserver://",
];

function classifySource(src: string): string | null {
  // 1. Check standard registry
  const manifest = lookupBySource(src);
  if (manifest) return manifest.name.replace(/^wiki-/, "").replace(/-agent$/, "");
  // 2. DB connection string fallback
  const lower = src.toLowerCase();
  if (DB_SCHEMES.some((s) => lower.startsWith(s))) return "db";
  return null;
}
```

There is no existing function for this — B7 must add it. Do NOT add it to `source_registry.ts`; the registry's contract is URL/scheme classification, not connection-string parsing.

### Also available: `builtinConnectorIds`

**Signature:**
```ts
export function builtinConnectorIds(): string[] // → ["jira","confluence","github","notion","gcp","aws","db"]
```

Reads directly from the static `BUILTIN_PATTERNS` array — does NOT require `initRegistry()`. Use to enumerate the 7 known connector ids without touching the registry.

---

## Capability (b): Read the set of CONFIGURED connector ids from `.connectors/config.yaml`

### No existing exported function for this.

`_defaultConnectorConfigPaths()` in `atlas_synthesize.ts` is **private** (not exported). It returns:
```ts
[
  path.join(process.cwd(), ".connectors", "config.yaml"),
  path.join(os.homedir(), ".connectors", "config.yaml"),
]
```
The first existing file wins. This logic is inlined inside `assembleIntegrationsInputs` and not reusable without duplication.

### Config schema (from `.connectors/config.example.yaml`)

Top-level key is `connectors`. Each child key is a connector id (matching `builtinConnectorIds()`). A connector is active when its block exists **and** has `enabled: true`.

```yaml
connectors:
  github:
    enabled: true
    token: env:GITHUB_TOKEN
  jira:
    enabled: true
    # ...
  db:
    enabled: true
    environments:
      dev:
        driver: postgresql
        # ...
```

### What B7 must add

Export a new helper (recommended location: `agents/lib/source_registry.ts`, since it logically extends connector classification):

```ts
// New export to add to source_registry.ts
export function loadConfiguredConnectorIds(
  connectorsConfigPath?: string,
): Set<string>
```

Implementation sketch (B7 can inline or extract):
```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";

export function loadConfiguredConnectorIds(
  connectorsConfigPath?: string,
): Set<string> {
  const candidates = connectorsConfigPath
    ? [connectorsConfigPath]
    : [
        path.join(process.cwd(), ".connectors", "config.yaml"),
        path.join(os.homedir(), ".connectors", "config.yaml"),
      ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    let parsed: unknown;
    try {
      parsed = yaml.load(fs.readFileSync(p, "utf-8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const connectors = (parsed as Record<string, unknown>)["connectors"];
    if (!connectors || typeof connectors !== "object" || Array.isArray(connectors)) {
      return new Set();
    }
    const out = new Set<string>();
    for (const [id, cfg] of Object.entries(connectors as Record<string, unknown>)) {
      if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
        if ((cfg as Record<string, unknown>)["enabled"] === true) {
          out.add(id);
        }
      }
    }
    return out;
  }
  return new Set();
}
```

**Flag for export:** `_defaultConnectorConfigPaths` in `atlas_synthesize.ts` should also be exported if `assembleIntegrationsInputs` ever needs to be split. For now, the new `loadConfiguredConnectorIds` helper fully covers B7's needs.

---

## Capability (c): Reuse existing narai-gather detection (CodeClientEntry)

### Function: `detectCodeClients`

**Import path:** `./atlas_inventory.js` (TS source: `agents/lib/atlas_inventory.ts`)

**Signature:**
```ts
export function detectCodeClients(repoRoot: string): CodeClientEntry[]
```

**Output type:**
```ts
export interface CodeClientEntry {
  kind: string;   // "gather" | "fetchWithCaps"
  file: string;   // repo-relative POSIX path
  line: number;   // 1-indexed
}
```

**What it detects:** Scans `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.mjs`, `**/*.cjs`, `**/*.py` for callsites of `gather(` (narai-primitives hub) and `fetchWithCaps(` (narai-primitives/toolkit). Per-line, returns `(kind, file, line)` tuples.

**B7 reuse contract:**  
B7's `narai_gather` external-source kind should derive from `CodeClientEntry` directly — do not re-scan. Call `detectCodeClients(repoRoot)` and filter/transform:

```ts
import { detectCodeClients } from "./atlas_inventory.js";

const clients = detectCodeClients(repoRoot);
// Each entry: { kind: "gather"|"fetchWithCaps", file, line }
// B7 maps these to ExternalDependency { kind: "narai_gather", file, line, connectorId: null }
```

If a previously-generated `CodeInventory` manifest exists for the current atlas run, load it via `loadInventory(wikiRoot, runId)` and read `inventory.code_clients` directly — no re-scan needed.

---

## Summary of new exports needed

| File | New export | Why |
|------|-----------|-----|
| `agents/lib/source_registry.ts` | `loadConfiguredConnectorIds(path?: string): Set<string>` | No existing function reads configured connector ids; `_defaultConnectorConfigPaths` is private to `atlas_synthesize.ts` |
| B7 script (new) | `classifySource(src: string): string \| null` | Wraps `lookupBySource` + DB connection-string fallback; not appropriate to add to `source_registry.ts` |

No changes needed to `atlas_inventory.ts` — `detectCodeClients` is already exported and its `CodeClientEntry` type is the correct shape for B7's `narai_gather` kind.
