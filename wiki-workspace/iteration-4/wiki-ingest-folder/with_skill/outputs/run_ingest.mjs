#!/usr/bin/env node
/**
 * Folder-batch ingest driver for the wiki-ingest-folder eval.
 *
 * Implements the SKILL.md /wiki-ingest folder pattern deterministically
 * using the compiled cache_manager + event_logger primitives:
 *   1. Read each file under docs/
 *   2. SHA256-hash the body
 *   3. cache_manager.checkCache(wikiRoot, hash) — hit means skip & log cache_hit
 *   4. On miss: write wiki page with frontmatter, copy raw, storeCache, log ingest
 *
 * Invoked as:
 *   node run_ingest.mjs <docsDir> <wikiRoot> <runLabel>
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  computeHash,
  checkCache,
  storeCache,
} from "/Users/narayan/src/doc-wiki/skills/wiki/scripts/cache_manager.js";
import { logEvent } from "/Users/narayan/src/doc-wiki/skills/wiki/scripts/event_logger.js";

const [docsDir, wikiRoot, runLabel] = process.argv.slice(2);
if (!docsDir || !wikiRoot || !runLabel) {
  console.error("usage: run_ingest.mjs <docsDir> <wikiRoot> <runLabel>");
  process.exit(2);
}

// Topic-tag vocabulary keyed by filename — content-only concept tags.
const TAGS = {
  "architecture.md": ["system-architecture", "service-mesh", "api-gateway", "kafka", "strangler-fig"],
  "auth.md": ["authentication", "oauth", "oidc", "opa-policy", "jwt"],
  "database.md": ["postgresql", "replication", "migrations", "backups", "pgbouncer"],
  "caching.md": ["redis-cache", "cdn", "cache-aside", "thundering-herd", "invalidation"],
  "deployment.md": ["ci-cd", "argocd", "canary-rollout", "cosign", "vault-secrets"],
  "monitoring.md": ["prometheus", "opentelemetry", "slo-alerting", "pagerduty", "postmortems"],
  "sdk.md": ["client-sdk", "oauth-client", "retry-backoff", "pagination", "idempotency"],
  "troubleshooting.md": ["error-budget", "latency-debugging", "jwks-rotation", "memory-pressure", "connection-leak"],
};

const TITLES = {
  "architecture.md": "System Architecture",
  "auth.md": "Authentication & Authorization",
  "database.md": "Database Operations",
  "caching.md": "Caching Strategy",
  "deployment.md": "Deployment Pipeline",
  "monitoring.md": "Monitoring and Observability",
  "sdk.md": "Client SDK Guide",
  "troubleshooting.md": "Troubleshooting Guide",
};

const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md")).sort();

fs.mkdirSync(path.join(wikiRoot, "raw"), { recursive: true });
fs.mkdirSync(path.join(wikiRoot, "wiki"), { recursive: true });

let ingestCount = 0;
let cacheHitCount = 0;

for (const fname of files) {
  const src = path.join(docsDir, fname);
  const body = fs.readFileSync(src, "utf-8");
  const hash = computeHash(body);

  const cached = checkCache(wikiRoot, hash);
  if (cached !== null) {
    cacheHitCount++;
    logEvent(wikiRoot, "cache_hit", {
      run: runLabel,
      source: src,
      content_hash: hash,
      cached_page: cached.wiki_page,
    });
    console.log(`  cache_hit  ${fname}  ${hash.slice(0, 12)}...`);
    continue;
  }

  // --- Cache miss: compile the wiki page ----------------------------

  const title = TITLES[fname] ?? fname.replace(/\.md$/, "");
  const tags = TAGS[fname] ?? [fname.replace(/\.md$/, "")];
  const slug = fname.replace(/\.md$/, "");
  const wikiRel = path.join("wiki", `${slug}.md`);
  const rawRel = path.join("raw", fname);

  const frontmatter = [
    "---",
    `title: "${title}"`,
    `page_type: reference`,
    `sources:`,
    `  - ${src}`,
    `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    `content_hash: "${hash}"`,
    `ingested_at: "${new Date().toISOString()}"`,
    "---",
    "",
  ].join("\n");

  const wikiBody = `# ${title}\n\n${body}\n\n## Related Pages\n\n(populated by crosslink hook)\n`;

  fs.writeFileSync(path.join(wikiRoot, wikiRel), frontmatter + wikiBody);

  // Copy source to raw/ preserving the filename.
  fs.copyFileSync(src, path.join(wikiRoot, rawRel));

  // Cache the content hash so the next run detects "no change".
  storeCache(wikiRoot, hash, {
    source: src,
    wiki_page: wikiRel,
    raw_path: rawRel,
    ingested_at: new Date().toISOString(),
  });

  logEvent(wikiRoot, "ingest", {
    run: runLabel,
    source: src,
    content_hash: hash,
    wiki_page: wikiRel,
    raw_path: rawRel,
    tags,
  });

  ingestCount++;
  console.log(`  ingest     ${fname}  ${hash.slice(0, 12)}...`);
}

logEvent(wikiRoot, "ingest_batch_summary", {
  run: runLabel,
  total_files: files.length,
  new_ingests: ingestCount,
  cache_hits: cacheHitCount,
});

console.log(
  `\nRun ${runLabel}: ${ingestCount} ingested, ${cacheHitCount} cache hits (of ${files.length} files).`,
);
