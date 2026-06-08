/**
 * cross-service-recall.ts
 *
 * Acceptance / recall harness for the static cross-service detector.
 * Measures how much of the hand-built gold-standard docs the detector recovers.
 *
 * Usage:
 *   npx tsx scripts/acceptance/cross-service-recall.ts [--repo-root <path>] [--gold-dir <path>]
 *
 * Defaults:
 *   --repo-root  <repo-root>
 *   --gold-dir   <repo-root>/docs/ai
 *
 * Service-name matching rule:
 *   Gold service names (e.g. "intake", "settings-service") are matched
 *   against detected service ids case-insensitively. A gold name matches a detected
 *   id when:
 *     1. Exact (case-insensitive) match, OR
 *     2. One is a prefix/suffix of the other with a dash boundary (abbrev match),
 *        e.g. gold "config-service" matches detected "settings-service".
 *   Shared library paths (shared/*) are only included in gold if they appear as
 *   a source service; they map to the sub-path component (e.g. "shared/common-model"
 *   stays as-is and is matched by prefix logic).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ─── Arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { repoRoot: string; goldDir: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true";
      args[key] = val;
    }
  }
  const repoRoot = expandHome(args["repo-root"] ?? ".");
  const goldDir = expandHome(args["gold-dir"] ?? path.join(repoRoot, "docs/ai"));
  return { repoRoot, goldDir };
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ─── Service name matching ───────────────────────────────────────────────────

/**
 * Normalize a service name for matching: lowercase, trim.
 */
function norm(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Match a gold name against the set of detected service ids.
 * Returns the detected id that best matches the gold name, or undefined.
 *
 * Matching rules (applied in priority order, case-insensitive):
 *  1. Exact match (highest priority — returned immediately)
 *  2. Token-prefix abbreviation match: each dash-delimited token in gold starts
 *     the corresponding token in detected (e.g. gold "config-service" matches
 *     detected "settings-service"). Both directions tried.
 *     Disambiguation: prefer the candidate with the MOST tokens in common / most
 *     specific match to avoid "archive-store" beating "archive-store-data" for gold "archive-store-data".
 *
 * Shared library paths (shared/*) match the sub-path component against the
 * "shared" service bucket; only exact matches are attempted for shared/* gold names.
 */
function matchService(goldName: string, detectedIds: string[]): string | undefined {
  const g = norm(goldName);
  const gCore = g.startsWith("shared/") ? g.slice("shared/".length) : g;

  // Pass 1: exact match
  for (const id of detectedIds) {
    const d = norm(id);
    const dCore = d.startsWith("shared/") ? d.slice("shared/".length) : d;
    if (g === d || gCore === dCore) return id;
  }

  // Pass 2: token-prefix abbreviation match — collect all candidates, pick best
  const gTokens = gCore.split("-");
  const candidates: Array<{ id: string; matchLen: number }> = [];

  for (const id of detectedIds) {
    const d = norm(id);
    const dCore = d.startsWith("shared/") ? d.slice("shared/".length) : d;
    const dTokens = dCore.split("-");

    // gold is an abbreviation of detected: each gold token is a prefix of the
    // corresponding detected token, and detected has >= gold token count.
    if (
      gTokens.length <= dTokens.length &&
      gTokens.every((gt, i) => dTokens[i]?.startsWith(gt))
    ) {
      candidates.push({ id, matchLen: dTokens.length });
    }
    // detected is an abbreviation of gold: each detected token is a prefix of gold token
    else if (
      dTokens.length < gTokens.length &&
      dTokens.every((dt, i) => gTokens[i]?.startsWith(dt))
    ) {
      candidates.push({ id, matchLen: dTokens.length });
    }
  }

  if (candidates.length === 0) return undefined;

  // Among candidates, prefer the one whose token count is CLOSEST to gTokens.length
  // (most specific). Ties broken alphabetically for determinism.
  candidates.sort((a, b) => {
    const aDelta = Math.abs(a.id.split("-").length - gTokens.length);
    const bDelta = Math.abs(b.id.split("-").length - gTokens.length);
    if (aDelta !== bDelta) return aDelta - bDelta;
    return a.id.localeCompare(b.id);
  });
  return candidates[0]!.id;
}

// ─── Gold feign-clients parser ───────────────────────────────────────────────

interface GoldCallEdge {
  source: string;
  target: string;
  raw: string; // for debug
}

/**
 * Parse feign-clients.md.
 * Format: "## By Source Project" section, then "### <source-service>" headings,
 * each followed by a markdown table whose "Target" column gives the target service.
 *
 * Also handles "Shared Library FeignClients" section with a different prose format:
 *   "### shared/X -> target-service (N interfaces)"
 */
function parseGoldFeignClients(filePath: string): GoldCallEdge[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const edges: GoldCallEdge[] = [];

  let currentSource: string | null = null;
  let targetColIndex = -1;
  let inTable = false;
  let pastBySourceSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Detect entry into "By Source Project" section
    if (line.startsWith("## By Source Project") || line.startsWith("## Shared Library")) {
      pastBySourceSection = true;
    }

    if (!pastBySourceSection) continue;

    // ### heading = new source service
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();

      // Shared library format: "shared/X -> target-service (N interfaces)"
      const sharedMatch = heading.match(/^(shared\/[\w-]+)\s*->\s*([\w-]+)/i);
      if (sharedMatch) {
        // Emit one edge for shared→target (shared lib acting as source)
        const src = sharedMatch[1]!.trim();
        const tgt = sharedMatch[2]!.trim();
        edges.push({ source: src, target: tgt, raw: heading });
        currentSource = null; // not a table source
        inTable = false;
      } else {
        // Normal per-source section: e.g. "### ledger-integration"
        currentSource = heading;
        inTable = false;
        targetColIndex = -1;
      }
      continue;
    }

    // If we hit a different ## section, reset
    if (line.startsWith("## ") && pastBySourceSection) {
      currentSource = null;
      inTable = false;
      continue;
    }

    if (currentSource === null) continue;

    // Parse table header to find "Target" column index
    if (line.startsWith("|") && line.toLowerCase().includes("target")) {
      const headers = line
        .split("|")
        .map((h) => h.trim())
        .filter((h) => h.length > 0);
      targetColIndex = headers.findIndex((h) => h.toLowerCase() === "target");
      inTable = true;
      continue;
    }

    // Skip separator row
    if (inTable && line.match(/^\|[\s|:-]+\|/)) continue;

    // Parse data row
    if (inTable && line.startsWith("|") && targetColIndex >= 0) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((_, i) => i > 0); // drop leading empty from split
      const target = cells[targetColIndex];
      if (target && target.length > 0 && !target.startsWith("-")) {
        edges.push({ source: currentSource, target, raw: line });
      }
      continue;
    }

    // If we see a blank line after a table, table may be done
    if (inTable && line.length === 0) {
      inTable = false;
    }
  }

  return edges;
}

// ─── Gold rabbitmq parser ─────────────────────────────────────────────────────

interface GoldQueueTriple {
  publisher: string;
  queue: string;
  consumer: string;
  raw: string;
}

/**
 * Parse rabbitmq-queues.md.
 * Format: sections with tables having columns like:
 *   Queue Name | Publisher | Consumer | ...
 * Publisher and Consumer cells contain "service-name (ClassName)" or just "service-name".
 * We extract the service name (before the parenthesis).
 */
function parseGoldQueueRegistry(filePath: string): GoldQueueTriple[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const triples: GoldQueueTriple[] = [];

  let queueColIndex = -1;
  let publisherColIndex = -1;
  let consumerColIndex = -1;
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table header with Queue Name / Publisher / Consumer columns
    if (
      trimmed.startsWith("|") &&
      trimmed.toLowerCase().includes("queue") &&
      (trimmed.toLowerCase().includes("publisher") || trimmed.toLowerCase().includes("consumer"))
    ) {
      const headers = trimmed
        .split("|")
        .map((h) => h.trim())
        .filter((h) => h.length > 0);
      queueColIndex = headers.findIndex((h) => h.toLowerCase().includes("queue"));
      publisherColIndex = headers.findIndex(
        (h) => h.toLowerCase().includes("publisher") || h.toLowerCase() === "pub"
      );
      consumerColIndex = headers.findIndex(
        (h) => h.toLowerCase().includes("consumer") || h.toLowerCase() === "con"
      );
      inTable = queueColIndex >= 0 && publisherColIndex >= 0 && consumerColIndex >= 0;
      continue;
    }

    // Skip separator
    if (trimmed.match(/^\|[\s|:-]+\|/)) continue;

    // Parse data rows
    if (inTable && trimmed.startsWith("|")) {
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((_, i) => i > 0);

      const queueName = cells[queueColIndex]?.replace(/^`|`$/g, "") ?? "";
      const publisherRaw = cells[publisherColIndex] ?? "";
      const consumerRaw = cells[consumerColIndex] ?? "";

      if (!queueName || queueName.startsWith("-")) {
        inTable = false;
        continue;
      }

      // Extract service name from "service-name (ClassName)" or "service-name"
      const extractService = (raw: string): string => {
        // Handle "shared/common-model (ClassName)" → "shared/common-model"
        const m = raw.match(/^([^\(]+)/);
        return m ? m[1]!.trim() : raw.trim();
      };

      const publisher = extractService(publisherRaw);
      const consumer = extractService(consumerRaw);

      if (publisher && consumer && publisher !== "-" && consumer !== "-") {
        triples.push({ publisher, queue: queueName, consumer, raw: trimmed });
      }
      continue;
    }

    // Blank line or non-table line resets table state
    if (!trimmed.startsWith("|") && inTable) {
      inTable = false;
    }
  }

  return triples;
}

// ─── Set helpers ─────────────────────────────────────────────────────────────

function edgeKey(a: string, b: string): string {
  return `${a}|||${b}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { repoRoot, goldDir } = parseArgs(process.argv.slice(2));

  console.log("=".repeat(70));
  console.log("Cross-Service Recall Acceptance Harness");
  console.log("=".repeat(70));
  console.log(`repo-root : ${repoRoot}`);
  console.log(`gold-dir  : ${goldDir}`);
  console.log();

  // ── Validate paths ──────────────────────────────────────────────────────
  if (!fs.existsSync(repoRoot)) {
    console.error(`ERROR: repo-root does not exist: ${repoRoot}`);
    process.exit(1);
  }

  const feignFile = path.join(goldDir, "feign-clients.md");
  const queueFile = path.join(goldDir, "rabbitmq-queues.md");

  if (!fs.existsSync(feignFile)) {
    console.error(`ERROR: gold file not found: ${feignFile}`);
    process.exit(1);
  }
  if (!fs.existsSync(queueFile)) {
    console.error(`ERROR: gold file not found: ${queueFile}`);
    process.exit(1);
  }

  // ── Run the detector ────────────────────────────────────────────────────
  console.log("Running detector (generateInventory + buildServiceGraph)...");
  console.log("(This may take a few minutes for a large repo)");
  console.log();

  let inv: Awaited<ReturnType<typeof import("../../agents/lib/atlas_inventory.js").generateInventory>>;
  let graph: Awaited<ReturnType<typeof import("../../agents/lib/cross_service_edges.js").buildServiceGraph>>;

  try {
    const { generateInventory } = await import("../../agents/lib/atlas_inventory.js");
    const { buildServiceGraph } = await import("../../agents/lib/cross_service_edges.js");

    inv = generateInventory(repoRoot, "2026-06-07T00-00-00", { enableCrossService: true });
    graph = buildServiceGraph(inv);
  } catch (err) {
    console.error("ERROR: Detector threw an exception:");
    console.error(err);
    process.exit(1);
  }

  // ── Safety filter: drop any edges whose evidence_file is under docs/ ────
  const totalEdgesBefore = graph.edges.length;
  const filteredEdges = graph.edges.filter((e) => {
    const rel = path.relative(repoRoot, e.evidence_file).split(path.sep).join("/");
    return !rel.startsWith("docs/");
  });
  const droppedDocEdges = totalEdgesBefore - filteredEdges.length;
  console.log(
    `Detector emitted ${totalEdgesBefore} edges total; dropped ${droppedDocEdges} from docs/ (gold contamination guard).`
  );
  console.log(`Remaining detected edges: ${filteredEdges.length}`);
  console.log();

  const detectedServiceIds = graph.services.map((s) => s.id);
  console.log(`Detected services (${detectedServiceIds.length}): ${detectedServiceIds.join(", ")}`);
  console.log();

  // ── Parse gold standards ─────────────────────────────────────────────────
  console.log("Parsing gold standards...");

  const goldFeignEdges = parseGoldFeignClients(feignFile);
  const goldQueueTriples = parseGoldQueueRegistry(queueFile);

  console.log(`  feign-clients.md: parsed ${goldFeignEdges.length} raw call edges`);
  console.log(`  rabbitmq-queues.md: parsed ${goldQueueTriples.length} raw queue triples`);
  console.log();

  // ── Build gold call-edge set (source → target, non-shared sources only) ─
  // We include all feign edges including shared/* sources.
  // Deduplicate by (source, target) pair.
  const goldCallSet = new Map<string, GoldCallEdge>(); // key -> first edge
  for (const e of goldFeignEdges) {
    const k = edgeKey(norm(e.source), norm(e.target));
    if (!goldCallSet.has(k)) goldCallSet.set(k, e);
  }

  // ── Build gold queue pair set (publisher → consumer via queue) ───────────
  const goldQueuePairSet = new Map<string, GoldQueueTriple>();
  for (const t of goldQueueTriples) {
    const k = edgeKey(norm(t.publisher), norm(t.consumer));
    if (!goldQueuePairSet.has(k)) goldQueuePairSet.set(k, t);
  }

  console.log(`Gold call edges (deduplicated): ${goldCallSet.size}`);
  console.log("Gold sources seen:");
  const goldSourcesMap = new Map<string, number>();
  for (const e of goldCallSet.values()) {
    goldSourcesMap.set(e.source, (goldSourcesMap.get(e.source) ?? 0) + 1);
  }
  for (const [src, cnt] of [...goldSourcesMap.entries()].sort()) {
    console.log(`  ${src}: ${cnt} target(s)`);
  }
  console.log();
  console.log(`Gold queue pairs (publisher→consumer, deduplicated): ${goldQueuePairSet.size}`);
  console.log();

  // ── Build detected call-edge set ─────────────────────────────────────────
  // calls edges: from_service → to_service where to_service is a real service
  // (not ext:, queue:, table:, auth: prefix)
  const detectedCallSet = new Set<string>();
  for (const e of filteredEdges) {
    if (e.kind === "calls" && !e.to_service.includes(":")) {
      detectedCallSet.add(edgeKey(norm(e.from_service), norm(e.to_service)));
    }
  }

  // ── Build detected queue pair set ────────────────────────────────────────
  // The graph uses two conventions for queue edges:
  //   produces: from_service=SERVICE, to_service=queue:<name>
  //   consumes: from_service=queue:<name>, to_service=SERVICE  (inverted!)
  // We normalize both to (queueName, service) maps.
  const queueProducers = new Map<string, Set<string>>(); // queue name → set of producer services
  const queueConsumers = new Map<string, Set<string>>(); // queue name → set of consumer services
  for (const e of filteredEdges) {
    if (e.kind === "produces" && e.to_service.startsWith("queue:")) {
      const q = e.to_service.slice("queue:".length);
      if (!queueProducers.has(q)) queueProducers.set(q, new Set());
      queueProducers.get(q)!.add(norm(e.from_service));
    }
    // consumes: from=queue:x, to=service (graph convention)
    if (e.kind === "consumes" && e.from_service.startsWith("queue:")) {
      const q = e.from_service.slice("queue:".length);
      if (!queueConsumers.has(q)) queueConsumers.set(q, new Set());
      queueConsumers.get(q)!.add(norm(e.to_service));
    }
    // also handle if consumes is stored as from=service, to=queue:x (forward convention)
    if (e.kind === "consumes" && e.to_service.startsWith("queue:")) {
      const q = e.to_service.slice("queue:".length);
      if (!queueConsumers.has(q)) queueConsumers.set(q, new Set());
      queueConsumers.get(q)!.add(norm(e.from_service));
    }
  }

  const detectedQueuePairSet = new Set<string>();
  for (const [q, producers] of queueProducers) {
    const consumers = queueConsumers.get(q) ?? new Set();
    for (const prod of producers) {
      for (const cons of consumers) {
        detectedQueuePairSet.add(edgeKey(prod, cons));
      }
    }
  }

  // ── Compute recall and precision ─────────────────────────────────────────

  // For matching: attempt to map gold service names to detected ids
  function resolveGoldName(goldName: string): string | undefined {
    return matchService(goldName, detectedServiceIds);
  }

  // Calls recall: for each gold (source, target), check if detected has a matching pair
  let callsHits = 0;
  const callsMisses: Array<{ gold: GoldCallEdge; hypothesis: string }> = [];

  for (const [, ge] of goldCallSet) {
    const detSrc = resolveGoldName(ge.source);
    const detTgt = resolveGoldName(ge.target);

    if (!detSrc) {
      callsMisses.push({
        gold: ge,
        hypothesis: `source service "${ge.source}" not discovered (not a checked-out submodule or not recognized as a service)`,
      });
      continue;
    }
    if (!detTgt) {
      callsMisses.push({
        gold: ge,
        hypothesis: `target service "${ge.target}" not discovered (not a checked-out submodule)`,
      });
      continue;
    }

    const detKey = edgeKey(norm(detSrc), norm(detTgt));
    if (detectedCallSet.has(detKey)) {
      callsHits++;
    } else {
      // Determine why it was missed
      let hypothesis = "";
      const srcEdges = filteredEdges.filter(
        (e) => norm(e.from_service) === norm(detSrc) && e.kind === "calls"
      );
      if (srcEdges.length === 0) {
        hypothesis = `no "calls" edges detected from "${detSrc}" — FeignClient annotations not detected in source (may need Spring feign client profile)`;
      } else {
        hypothesis = `"${detSrc}" has ${srcEdges.length} detected call(s) but none resolve to "${detTgt}" — FeignClient URL uses unresolved @Value property, or service URL is in a config file not scanned`;
      }
      callsMisses.push({ gold: ge, hypothesis });
    }
  }

  const callsRecall =
    goldCallSet.size === 0 ? 0 : (callsHits / goldCallSet.size) * 100;

  // Precision for calls
  // Count detected pairs that have valid gold-matched sources and targets
  let detectedCallsInGoldSpace = 0;
  let detectedCallsHits = 0;
  for (const key of detectedCallSet) {
    const [ds, dt] = key.split("|||");
    // Only count if both services appear in gold space
    const goldSrcs = [...goldCallSet.values()].map((e) => resolveGoldName(e.source)).filter(Boolean);
    const goldTgts = [...goldCallSet.values()].map((e) => resolveGoldName(e.target)).filter(Boolean);
    if (goldSrcs.includes(ds) || goldTgts.includes(dt)) {
      detectedCallsInGoldSpace++;
      if (goldCallSet.has(key)) detectedCallsHits++;
    }
  }

  // Queue recall: for each gold (publisher, consumer), check if detected has matching pair
  let queueHits = 0;
  const queueMisses: Array<{ gold: GoldQueueTriple; hypothesis: string }> = [];

  for (const [, gt] of goldQueuePairSet) {
    const detPub = resolveGoldName(gt.publisher);
    const detCons = resolveGoldName(gt.consumer);

    if (!detPub) {
      queueMisses.push({
        gold: gt,
        hypothesis: `publisher "${gt.publisher}" not discovered as a service`,
      });
      continue;
    }
    if (!detCons) {
      queueMisses.push({
        gold: gt,
        hypothesis: `consumer "${gt.consumer}" not discovered as a service`,
      });
      continue;
    }

    const detKey = edgeKey(norm(detPub), norm(detCons));
    if (detectedQueuePairSet.has(detKey)) {
      queueHits++;
    } else {
      // Dig into why
      const pubQueues = [...queueProducers.entries()]
        .filter(([, pubs]) => pubs.has(norm(detPub)))
        .map(([q]) => q);
      const consQueues = [...queueConsumers.entries()]
        .filter(([, cons]) => cons.has(norm(detCons)))
        .map(([q]) => q);
      // Also check using raw service ids in case resolution differed
      let hypothesis = "";
      if (pubQueues.length === 0 && consQueues.length === 0) {
        hypothesis = `neither publisher "${detPub}" nor consumer "${detCons}" detected with any queue edges — @RabbitListener/@RabbitHandler annotations not picked up by queue profile`;
      } else if (pubQueues.length === 0) {
        hypothesis = `publisher "${detPub}" not detected sending to any queue — queue name likely a constant/property reference not resolved`;
      } else if (consQueues.length === 0) {
        hypothesis = `consumer "${detCons}" not detected listening to any queue`;
      } else {
        // both have queues but they don't overlap → shared queue via gt.queue not linked
        hypothesis = `publisher queues=[${pubQueues.slice(0, 3).join(",")}] and consumer queues=[${consQueues.slice(0, 3).join(",")}] don't share queue "${gt.queue}" — queue name is a Spring property/constant not resolved to literal`;
      }
      queueMisses.push({ gold: gt, hypothesis });
    }
  }

  const queueRecall =
    goldQueuePairSet.size === 0 ? 0 : (queueHits / goldQueuePairSet.size) * 100;

  // ── Print results ─────────────────────────────────────────────────────────

  console.log("=".repeat(70));
  console.log("RECALL RESULTS");
  console.log("=".repeat(70));
  console.log();
  console.log("── CALLS (FeignClient) ─────────────────────────────────────────────");
  console.log(`  Gold edges         : ${goldCallSet.size}`);
  console.log(`  Detected call edges: ${detectedCallSet.size}`);
  console.log(`  Hits               : ${callsHits}`);
  console.log(`  Misses             : ${callsMisses.length}`);
  console.log(`  RECALL             : ${callsRecall.toFixed(1)}%`);
  console.log();
  console.log("── QUEUES (RabbitMQ producer→consumer) ─────────────────────────────");
  console.log(`  Gold pairs         : ${goldQueuePairSet.size}`);
  console.log(`  Detected pairs     : ${detectedQueuePairSet.size}`);
  console.log(`  Hits               : ${queueHits}`);
  console.log(`  Misses             : ${queueMisses.length}`);
  console.log(`  RECALL             : ${queueRecall.toFixed(1)}%`);
  console.log();

  // ── Top misses ────────────────────────────────────────────────────────────
  const TOP_N = 15;

  console.log(`── TOP CALL MISSES (showing up to ${TOP_N}) ───────────────────────────`);
  for (const { gold, hypothesis } of callsMisses.slice(0, TOP_N)) {
    console.log(`  MISS  ${gold.source} → ${gold.target}`);
    console.log(`        ↳ ${hypothesis}`);
  }
  if (callsMisses.length > TOP_N) {
    console.log(`  ... and ${callsMisses.length - TOP_N} more call misses`);
  }
  console.log();

  console.log(`── TOP QUEUE MISSES (showing up to ${TOP_N}) ──────────────────────────`);
  for (const { gold, hypothesis } of queueMisses.slice(0, TOP_N)) {
    console.log(`  MISS  ${gold.publisher} → [${gold.queue}] → ${gold.consumer}`);
    console.log(`        ↳ ${hypothesis}`);
  }
  if (queueMisses.length > TOP_N) {
    console.log(`  ... and ${queueMisses.length - TOP_N} more queue misses`);
  }
  console.log();

  // ── Detected edges summary ────────────────────────────────────────────────
  console.log("── DETECTED EDGES BREAKDOWN ─────────────────────────────────────────");
  const kindCounts: Record<string, number> = {};
  for (const e of filteredEdges) {
    kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
  }
  for (const [k, cnt] of Object.entries(kindCounts).sort()) {
    console.log(`  ${k.padEnd(20)}: ${cnt}`);
  }
  console.log();

  // ── Bar chart ─────────────────────────────────────────────────────────────
  const TARGET = 80;
  const callsBar = makeBar(callsRecall, 100, 40);
  const queueBar = makeBar(queueRecall, 100, 40);
  console.log("── RECALL vs TARGET (≥80%) ──────────────────────────────────────────");
  console.log(`  Calls : [${callsBar}] ${callsRecall.toFixed(1)}% ${callsRecall >= TARGET ? "✓" : "✗ BELOW TARGET"}`);
  console.log(`  Queues: [${queueBar}] ${queueRecall.toFixed(1)}% ${queueRecall >= TARGET ? "✓" : "✗ BELOW TARGET"}`);
  console.log();

  if (callsRecall < TARGET || queueRecall < TARGET) {
    console.log(
      "NOTE: Recall is below the ≥80% target. Key tuning signals from the misses above."
    );
  } else {
    console.log("Recall meets or exceeds the ≥80% target.");
  }
  console.log("=".repeat(70));
}

function makeBar(val: number, max: number, width: number): string {
  const filled = Math.round((Math.min(val, max) / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
