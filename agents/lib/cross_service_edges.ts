import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServiceIdentity } from "./service_discovery.js";
import { loadInventory } from "./atlas_inventory.js";
import type { CodeInventory } from "./atlas_inventory.js";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";

/**
 * Normalize a URL or path for cross-service matching:
 *  strip scheme+host, strip query/fragment, collapse duplicate slashes,
 *  replace every parameter segment ({x}, {x:\d+}, :x, ${x}, <int:x>, [x]) with a
 *  nameless `{}` sentinel (positions + literal segments survive; param NAMES are discarded),
 *  ensure a single leading slash, strip a trailing slash (except root "/").
 */
export function normalizePath(raw: string): string {
  let p = raw.trim();
  // strip scheme + authority (http://host, https://host, etc.)
  p = p.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+/, "");
  // strip query/fragment
  p = p.replace(/[?#].*$/, "");
  if (p.length === 0) return "/";
  // split, sentinelize param segments, drop empties (collapses //)
  const segs = p.split("/").filter((s) => s.length > 0).map((seg) => {
    // a segment is a param if it is wholly a placeholder OR contains one
    if (/^\{.*\}$/.test(seg) || /^:.+/.test(seg) || /^\$\{.*\}$/.test(seg) ||
        /^<.*>$/.test(seg) || /^\[.*\]$/.test(seg)) {
      return "{}";
    }
    // mixed segment containing an interpolation → also a param (precision: treat as {})
    if (/\$\{|\{|:|<|\[/.test(seg) && /\}|>|\]/.test(seg)) return "{}";
    return seg;
  });
  return "/" + segs.join("/");
}

/**
 * Template-aware path match: does a client's (normalized) request path match an
 * endpoint's (normalized) route template? Both are normalized via
 * `normalizePath` (param segments → `{}`). Segment counts must be equal; each
 * segment matches iff the endpoint segment is the `{}` wildcard (matches any
 * client segment, including a concrete id) or is literally equal. So a client
 * `/api/orders/12345` matches an endpoint `/api/orders/{id}` (→ `/api/orders/{}`).
 */
export function pathMatches(clientNorm: string, endpointNorm: string): boolean {
  const c = clientNorm.split("/");
  const e = endpointNorm.split("/");
  if (c.length !== e.length) return false;
  for (let i = 0; i < e.length; i++) {
    if (e[i] === "{}") continue; // wildcard matches any client segment
    if (e[i] !== c[i]) return false;
  }
  return true;
}

/**
 * Resolve a raw client `target_ref` to the owning service via id + aliases.
 *  Handles: exact service id; `${key}` → strip to `key` → alias match; an absolute
 *  URL whose host label encodes the service (`payments-api` → strip `app-`/`-api`/`-svc`
 *  → match id/alias); a `/api/{seg}/...` path → `seg` → alias match. Returns undefined
 *  when nothing matches (an external host).
 */
export function resolveTargetService(
  ref: string,
  services: readonly ServiceIdentity[],
): ServiceIdentity | undefined {
  if (!ref) return undefined;
  const candidates = new Set<string>();
  const add = (s: string) => { if (s) candidates.add(s.toLowerCase()); };

  // raw + lowercased
  add(ref);
  // ${key} → key (and key with a trailing .url/.uri/.host/.endpoint stripped,
  // so `${config-service.url}` also tries the candidate `config-service`).
  const ph = ref.match(/^\$\{([\w.-]+)\}/);
  if (ph?.[1]) {
    add(ph[1]);
    add(ph[1].replace(/\.(url|uri|host|endpoint)$/i, ""));
  }
  // absolute URL → host label + first /api/{seg}/
  const urlM = ref.match(/^[a-zA-Z][\w+.-]*:\/\/([^/]+)(\/[^?#]*)?/);
  if (urlM) {
    const host = urlM[1]!.split(":")[0]!;         // strip port
    const label = host.split(".")[0]!;            // first DNS label
    add(label);
    add(label.replace(/^app-/, "").replace(/-(api|svc|service)$/, ""));
    const apiSeg = (urlM[2] ?? "").match(/\/api\/([\w-]+)/);
    if (apiSeg?.[1]) add(apiSeg[1]);
  } else {
    // bare ref that itself is a /api/{seg}/ path
    const apiSeg = ref.match(/\/api\/([\w-]+)/);
    if (apiSeg?.[1]) add(apiSeg[1]);
  }

  for (const svc of services) {
    const keys = [svc.id, ...svc.aliases].map((s) => s.toLowerCase());
    if (keys.some((k) => candidates.has(k))) return svc;
  }
  return undefined;
}

// ── Service graph types ───────────────────────────────────────────────

export type EdgeKind =
  | "calls"
  | "produces"
  | "consumes"
  | "reads_table"
  | "depends_on"
  | "auth_via"
  | "external_source";
export type Confidence = "high" | "medium" | "low";

export interface ServiceEdge {
  from_service: string;
  /** An internal service id, OR a synthetic node: `ext:<...>`, `queue:<name>`, `table:<name>`. */
  to_service: string;
  kind: EdgeKind;
  detail: string;
  confidence: Confidence;
  evidence_file: string;
  evidence_line: number;
}

export interface ServiceGraph {
  services: Array<{ id: string; kind: string; language: string; root: string }>;
  edges: ServiceEdge[];
  /** Caller stamps; default "" when built internally. */
  generated_at: string;
}

// depends_on + auth_via edges are emitted in buildServiceGraph below.

// ── buildServiceGraph ─────────────────────────────────────────────────

/**
 * Build a typed service graph from a `CodeInventory`. Pure function — no fs,
 * no walking. Emits edges of kinds: calls, produces, consumes, reads_table,
 * external_source. Deduplicates by (from, to, kind, detail).
 */
export function buildServiceGraph(inventory: CodeInventory): ServiceGraph {
  const services = inventory.services ?? [];
  const identities = services.map((s) => s.identity);
  const edges: ServiceEdge[] = [];
  const seen = new Set<string>();

  const push = (e: ServiceEdge) => {
    const k = `${e.from_service}|${e.to_service}|${e.kind}|${e.detail}`;
    if (!seen.has(k)) { seen.add(k); edges.push(e); }
  };

  for (const s of services) {
    const from = s.identity.id;

    // ── calls (client → endpoint); unresolved external host → external_source ──
    for (const c of s.http_clients) {
      // Resolve the target service. Prefer the resolved property value (e.g.
      // `${config-service.url}` → its application.yml URL → host → service),
      // then the raw target_ref, then the request path as a last-resort
      // fallback. `viaTargetRef` records whether the target was explicitly
      // named (target_ref/resolved_target) vs. inferred from the path alone.
      const byTargetRef =
        resolveTargetService(c.resolved_target ?? c.target_ref, identities) ??
        resolveTargetService(c.target_ref, identities);
      const target = byTargetRef ?? resolveTargetService(c.path, identities);
      const viaTargetRef = byTargetRef !== undefined;

      if (!target) {
        // External host not mapped to any internal service → external_source edge.
        const host = _extHost(c.target_ref) || _extHost(c.path);
        if (host) {
          push({
            from_service: from,
            to_service: `ext:http:${host}`,
            kind: "external_source",
            detail: `http ${c.method} ${host}`,
            confidence: "medium",
            evidence_file: c.file,
            evidence_line: c.line,
          });
        }
        continue;
      }

      if (target.id === from) continue; // self-call, skip

      const np = normalizePath(c.path);
      // Look up the full ServiceInventory for the target to access rest_endpoints.
      const tgtSvc = services.find((x) => x.identity.id === target.id);
      const matched = tgtSvc?.rest_endpoints.some(
        (e) => e.method.toUpperCase() === c.method.toUpperCase() && pathMatches(np, normalizePath(e.path)),
      ) ?? false;

      // Emit a calls edge ONLY when the target was explicitly named (high if an
      // endpoint matches, else medium — a named target justifies a medium edge),
      // OR when resolution was path-fallback only AND an endpoint matches (high).
      // A path-fallback that resolves a service with NO matching endpoint is a
      // false positive — skip it.
      if (!viaTargetRef && !matched) continue;

      push({
        from_service: from,
        to_service: target.id,
        kind: "calls",
        detail: `${c.method} ${np}`,
        confidence: matched ? "high" : "medium",
        evidence_file: c.file,
        evidence_line: c.line,
      });
    }

    // ── reads_table (per-service ORM entities → DB tables) ──
    for (const o of s.orm_entities ?? []) {
      const table = o.schema_name ? `${o.schema_name}.${o.table_name}` : o.table_name;
      push({
        from_service: from,
        to_service: `table:${table}`,
        kind: "reads_table",
        detail: `entity ${o.class_name} → ${table}`,
        confidence: "high",
        evidence_file: o.source_file,
        evidence_line: 0,
      });
    }

    // ── external_source (datasource / cloud SDK / narai gather callsites) ──
    for (const x of s.external_sources ?? []) {
      const node = x.connector_id ? `ext:${x.connector_id}` : `ext:${x.kind}`;
      push({
        from_service: from,
        to_service: node,
        kind: "external_source",
        detail: `${x.kind}${x.configured ? " (configured)" : ""}: ${x.connector_id || x.kind} ${x.detail}`,
        confidence: "high",
        evidence_file: x.file,
        evidence_line: x.line,
      });
    }

    // ── depends_on (shared-library pom dependency) ──
    // Use the real pom path (may differ from root/pom.xml for nested-build-subdir layouts).
    const depEvidenceFile = s.pom_path ?? `${s.identity.root}/pom.xml`;
    for (const lib of s.library_deps ?? []) {
      push({
        from_service: from,
        to_service: lib,
        kind: "depends_on",
        detail: `lib:${lib}`,
        confidence: "high",
        evidence_file: depEvidenceFile,
        evidence_line: 0,
      });
    }

    // ── auth_via (OAuth2 resource-server issuer) ──
    if (s.auth_issuer) {
      const host = s.auth_issuer.match(/^https?:\/\/([^/]+)/)?.[1] ?? s.auth_issuer;
      push({
        from_service: from,
        to_service: `auth:${host}`,
        kind: "auth_via",
        detail: `issuer:${s.auth_issuer}`,
        confidence: "high",
        evidence_file: "",
        evidence_line: 0,
      });
    }
  }

  // ── produces / consumes (queue name matched across services) ──
  //
  // Exchange→queue binding bridge: a RabbitMQ producer sends to an EXCHANGE with
  // a routing key, but the consumer listens on a QUEUE bound to that exchange via
  // a `Binding` declaration. Without resolving the binding, the producer's captured
  // name (the exchange / routing key) never matches the consumer's queue name and
  // the produces/consumes path splits. We collect every detected binding into two
  // lookups (routing_key → queues, exchange → queues), then for each producer the
  // candidate queue set is {its own name} ∪ {queues bound from that name}. A
  // produces edge is emitted to each candidate queue, so the producer connects to
  // the bound queue the consumer reads. Only REAL detected bindings are bridged
  // (no invented exchange→queue links) — precision over recall.
  const bindByRoutingKey = new Map<string, Set<string>>();
  const bindByExchange = new Map<string, Set<string>>();
  const addBind = (m: Map<string, Set<string>>, key: string, queue: string) => {
    if (!key || !queue) return;
    const set = m.get(key) ?? new Set<string>();
    set.add(queue);
    m.set(key, set);
  };
  for (const s of services) {
    for (const b of s.queue_bindings ?? []) {
      addBind(bindByRoutingKey, b.routing_key, b.queue_name);
      addBind(bindByExchange, b.exchange, b.queue_name);
    }
  }

  type QueueAccum = {
    producers: Array<{ id: string; f: string; l: number }>;
    consumers: Array<{ id: string; f: string; l: number }>;
  };
  const byQueue = new Map<string, QueueAccum>();
  const addToQueue = (
    queue: string,
    role: "producer" | "consumer",
    id: string,
    f: string,
    l: number,
  ) => {
    const entry = byQueue.get(queue) ?? { producers: [], consumers: [] };
    if (role === "producer") entry.producers.push({ id, f, l });
    else entry.consumers.push({ id, f, l });
    byQueue.set(queue, entry);
  };
  for (const s of services) {
    for (const q of s.queue_endpoints ?? []) {
      if (q.role === "producer") {
        // Candidate queues: the producer's own captured name (raw exchange /
        // routing-key / queue) PLUS any queue a binding maps that name to. The
        // raw-name edge is kept (harmless; matches direct queue→queue flows).
        const candidates = new Set<string>([q.queue_name]);
        for (const bound of bindByRoutingKey.get(q.queue_name) ?? []) candidates.add(bound);
        for (const bound of bindByExchange.get(q.queue_name) ?? []) candidates.add(bound);
        for (const queue of candidates) {
          addToQueue(queue, "producer", s.identity.id, q.file, q.line);
        }
      } else {
        addToQueue(q.queue_name, "consumer", s.identity.id, q.file, q.line);
      }
    }
  }
  for (const [queue, { producers, consumers }] of byQueue) {
    for (const p of producers) {
      push({
        from_service: p.id,
        to_service: `queue:${queue}`,
        kind: "produces",
        detail: `queue:${queue}`,
        confidence: "high",
        evidence_file: p.f,
        evidence_line: p.l,
      });
    }
    for (const c of consumers) {
      push({
        from_service: `queue:${queue}`,
        to_service: c.id,
        kind: "consumes",
        detail: `queue:${queue}`,
        confidence: "high",
        evidence_file: c.f,
        evidence_line: c.l,
      });
    }
  }

  // ── transitive Feign propagation (shared-library clients → depending services) ──
  // For each library L with http_clients, resolve those clients to targets (same
  // logic as the direct calls loop). Then for each depends_on edge S → L,
  // emit a medium-confidence calls edge S → T, unless S already has a direct
  // calls edge to T (to avoid redundant duplicate-meaning edges).

  // Step 1: build libClients map: libId → resolved call targets
  type LibClient = { target: ServiceIdentity; detail: string; file: string; line: number };
  const libClients = new Map<string, LibClient[]>();
  for (const s of services) {
    if (s.identity.kind !== "library") continue;
    const libId = s.identity.id;
    const resolved: LibClient[] = [];
    for (const c of s.http_clients) {
      const target =
        resolveTargetService(c.resolved_target ?? c.target_ref, identities) ??
        resolveTargetService(c.target_ref, identities) ??
        resolveTargetService(c.path, identities);
      if (!target || target.id === libId) continue;
      const np = normalizePath(c.path);
      resolved.push({ target, detail: `${c.method} ${np}`, file: c.file, line: c.line });
    }
    if (resolved.length > 0) libClients.set(libId, resolved);
  }

  // Step 2: for each depends_on edge S → L, propagate library's calls to S
  // Collect direct calls edges for dedup check (S → T existing direct calls).
  const directCalls = new Set<string>(); // "fromId|toId"
  for (const e of edges) {
    if (e.kind === "calls") directCalls.add(`${e.from_service}|${e.to_service}`);
  }

  for (const e of edges) {
    if (e.kind !== "depends_on") continue;
    const consumerSvcId = e.from_service;
    const libId = e.to_service;
    const targets = libClients.get(libId);
    if (!targets) continue;
    for (const { target, detail, file, line } of targets) {
      if (target.id === consumerSvcId) continue; // skip self
      if (directCalls.has(`${consumerSvcId}|${target.id}`)) continue; // direct edge already exists
      push({
        from_service: consumerSvcId,
        to_service: target.id,
        kind: "calls",
        detail: `via lib ${libId} (${detail})`,
        confidence: "medium",
        evidence_file: file,
        evidence_line: line,
      });
    }
  }

  return {
    services: identities.map((i) => ({
      id: i.id, kind: i.kind, language: i.language, root: i.root,
    })),
    edges,
    generated_at: "",
  };
}

// ── Graph analytics ───────────────────────────────────────────────────

/** Inbound `calls` count per target service, descending. */
export function rankInbound(graph: ServiceGraph): Array<{ service: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.kind === "calls") {
      counts.set(e.to_service, (counts.get(e.to_service) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Cyclic clusters over `calls` edges (internal service nodes only). Returns
 * each cyclic cluster as an id list — a robust answer to "which services are
 * in a dependency cycle". Uses Tarjan's strongly-connected-components: every
 * SCC of size ≥ 2 is a cyclic cluster (so convergent cycles like A→B→C→A and
 * A→D→C→A collapse to one cluster {A,B,C,D}); plus any self-loop node (A→A).
 */
export function detectCycles(graph: ServiceGraph): string[][] {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  const selfLoops = new Set<string>();
  for (const e of graph.edges) {
    if (
      e.kind === "calls" &&
      !e.to_service.startsWith("ext:") &&
      !e.to_service.startsWith("queue:") &&
      !e.to_service.startsWith("table:")
    ) {
      adj.set(e.from_service, [...(adj.get(e.from_service) ?? []), e.to_service]);
      nodes.add(e.from_service);
      nodes.add(e.to_service);
      if (e.from_service === e.to_service) selfLoops.add(e.from_service);
    }
  }

  // Tarjan's SCC (iterative — no recursion depth limit).
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const tStack: string[] = [];
  const sccs: string[][] = [];

  for (const start of nodes) {
    if (idx.has(start)) continue;
    // Work stack of frames; `i` is the next neighbor index to visit.
    const work: Array<{ v: string; i: number }> = [{ v: start, i: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const v = frame.v;
      if (frame.i === 0) {
        idx.set(v, index);
        low.set(v, index);
        index++;
        tStack.push(v);
        onStack.add(v);
      }
      const neighbors = adj.get(v) ?? [];
      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i]!;
        frame.i++;
        if (!idx.has(w)) {
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      } else {
        // Done with v's neighbors: settle low-links and, if a root, pop an SCC.
        if (low.get(v) === idx.get(v)) {
          const component: string[] = [];
          let w: string;
          do {
            w = tStack.pop()!;
            onStack.delete(w);
            component.push(w);
          } while (w !== v);
          if (component.length >= 2) sccs.push(component);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.v, Math.min(low.get(parent.v)!, low.get(v)!));
      }
    }
  }

  // Self-loops are size-1 SCCs Tarjan won't report — add any not already covered.
  const covered = new Set(sccs.flat());
  for (const n of selfLoops) {
    if (!covered.has(n)) sccs.push([n]);
  }
  return sccs;
}

// ── Internal helpers ──────────────────────────────────────────────────

/**
 * Extract the host label from an absolute URL or `${placeholder}` reference,
 * for use as the synthetic `ext:http:<host>` node name.
 * Returns "" when the ref is not an absolute URL or placeholder.
 */
function _extHost(ref: string): string {
  // Absolute URL → first authority label (strip port).
  const urlM = ref.match(/^[a-zA-Z][\w+.-]*:\/\/([^/:?#]+)/);
  if (urlM?.[1]) return urlM[1];
  // ${placeholder} → the key inside braces.
  const ph = ref.match(/^\$\{([\w.-]+)\}/);
  return ph?.[1] ?? "";
}

// ── Persistence ───────────────────────────────────────────────────────

/** Canonical on-disk path for a service graph given a wiki root + run id. */
export function serviceGraphPath(wikiRoot: string, runId: string): string {
  return path.join(wikiRoot, "outputs", "atlas", runId, "service-graph.json");
}

/** Persist a ServiceGraph; creates the dir tree; returns the path written. */
export function persistServiceGraph(
  wikiRoot: string,
  runId: string,
  graph: ServiceGraph,
): string {
  const target = serviceGraphPath(wikiRoot, runId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(graph, null, 2) + "\n");
  return target;
}

/** Read a previously-persisted graph; null on missing/malformed. */
export function loadServiceGraph(
  wikiRoot: string,
  runId: string,
): ServiceGraph | null {
  const target = serviceGraphPath(wikiRoot, runId);
  if (!fs.existsSync(target)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf-8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.edges) ||
      !Array.isArray(parsed.services)
    ) return null;
    return parsed as ServiceGraph;
  } catch {
    return null;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────

const _SG_FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--run-id": "runId",
} as const;

const _SG_RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

const _SG_HELP = `usage: cross_service_edges.js build --wiki-root <p> --run-id <id>

Build the service graph from a persisted code-inventory and write service-graph.json.
  --wiki-root <p>   Wiki root (where outputs/atlas/<run-id>/ lives)
  --run-id <id>     Atlas run id (YYYY-MM-DDTHH-MM-SS)
Stdout: the service graph JSON with an added 'written' field.
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(_SG_HELP);
    return 0;
  }
  if (argv[0] !== "build") {
    process.stderr.write(`unknown subcommand: ${argv[0]}\n`);
    return 2;
  }
  let parsed;
  try {
    parsed = parseFlags(argv.slice(1), _SG_FLAG_SPEC);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(_SG_HELP);
    return 0;
  }
  const wikiRoot = parsed.values["wikiRoot"];
  const runId = parsed.values["runId"];
  if (typeof wikiRoot !== "string" || wikiRoot.length === 0) {
    process.stderr.write("--wiki-root is required\n");
    return 2;
  }
  if (typeof runId !== "string" || !_SG_RUN_ID_RE.test(runId)) {
    process.stderr.write("--run-id is required and must match YYYY-MM-DDTHH-MM-SS\n");
    return 2;
  }
  const inv = loadInventory(wikiRoot, runId);
  if (!inv) {
    process.stderr.write(`no code-inventory.json for run ${runId} under ${wikiRoot}\n`);
    return 1;
  }
  const graph = buildServiceGraph(inv);
  let written: string;
  try {
    written = persistServiceGraph(wikiRoot, runId, graph);
  } catch (e) {
    process.stderr.write(`persist failed: ${(e as Error).message}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify({ ...graph, written }) + "\n");
  return 0;
}

const _sgThisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === _sgThisFile) {
  process.exit(main());
}
