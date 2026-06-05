#!/usr/bin/env -S npx tsx
// case-study-init — scaffolds case-study-output/ in the current dir.
// Auto-detects codebase shape (LOC, age, language, framework, ORM, DB);
// prompts only for things that can't be detected (description, internal-tool name,
// privacy posture, ticket sample size); writes a filled-in PROMPT.md you paste
// into Claude Code.
//
// Run from inside the codebase you want to document:
//   curl -fsSL https://raw.githubusercontent.com/narailabs/doc-wiki/main/launch/case-study-init.ts \
//     | npx tsx -
//
// or with CLI flags / env vars (skips the interactive prompts):
//   PROJECT_NAME=my-app INTERNAL_TOOL_NAME=our-docs PRIVATE=true \
//     npx tsx launch/case-study-init.ts

import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  statSync,
  createReadStream,
  createWriteStream,
} from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// When invoked as `curl ... | npx tsx -`, stdin is the pipe and stdin.isTTY is
// false — every interactive prompt silently falls back to its default. Open
// /dev/tty directly so the prompts still appear when the user can answer.
// Returns null when no terminal is available (Windows, sandboxed CI, etc.).
function openControllingTty(): { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } | null {
  if (stdin.isTTY && stdout.isTTY) {
    return { input: stdin, output: stdout };
  }
  if (process.env.CI) return null;
  try {
    if (!existsSync("/dev/tty")) return null;
    const input = createReadStream("/dev/tty");
    const output = createWriteStream("/dev/tty");
    return { input, output };
  } catch {
    return null;
  }
}

interface Parameters {
  PROJECT_NAME: string;
  PROJECT_DESCRIPTION: string;
  INTERNAL_TOOL_NAME: string;
  INTERNAL_TOOL_LOCATION: string;
  EXTERNAL_CONNECTORS_ENABLED: string;
  PRIVATE: "true" | "false";
  TICKET_SAMPLE_SIZE: string;
  // auto-detected fields (used for the summary, not in the prompt)
  _detected: {
    loc: number;
    age_years: number;
    languages: string;
    frameworks: string;
    orm: string;
    db: string;
  };
}

function sh(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function fileExistsContaining(path: string, needles: string[]): boolean {
  if (!exists(path)) return false;
  try {
    const c = readFileSync(path, "utf-8");
    return needles.some((n) => c.includes(n));
  } catch {
    return false;
  }
}

function anyExists(cwd: string, paths: string[]): string | null {
  for (const p of paths) if (exists(join(cwd, p))) return p;
  return null;
}

function detectProjectName(cwd: string): string {
  // package.json > pyproject.toml > Cargo.toml > go.mod > git remote > dir basename
  for (const file of ["package.json", "deno.json"]) {
    const p = join(cwd, file);
    if (exists(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf-8")) as { name?: string };
        if (j.name) return j.name.replace(/^@[^/]+\//, "");
      } catch {/* */ }
    }
  }
  if (exists(join(cwd, "pyproject.toml"))) {
    const c = readFileSync(join(cwd, "pyproject.toml"), "utf-8");
    const m = c.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1]!;
  }
  if (exists(join(cwd, "Cargo.toml"))) {
    const c = readFileSync(join(cwd, "Cargo.toml"), "utf-8");
    const m = c.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1]!;
  }
  if (exists(join(cwd, "go.mod"))) {
    const c = readFileSync(join(cwd, "go.mod"), "utf-8");
    const m = c.match(/^module\s+(\S+)/m);
    if (m) return basename(m[1]!);
  }
  const remote = sh("git config remote.origin.url", cwd);
  if (remote) {
    const m = remote.match(/[/:]([^/]+?)(?:\.git)?$/);
    if (m) return m[1]!;
  }
  return basename(cwd);
}

function detectLoc(cwd: string): number {
  if (sh("which tokei", cwd)) {
    const out = sh("tokei --output json", cwd);
    if (out) {
      try {
        const j = JSON.parse(out) as { Total?: { code?: number } };
        if (j.Total?.code) return j.Total.code;
      } catch { /* */ }
    }
  }
  if (sh("which cloc", cwd)) {
    const out = sh("cloc --json --quiet .", cwd);
    if (out) {
      try {
        const j = JSON.parse(out) as { SUM?: { code?: number } };
        if (j.SUM?.code) return j.SUM.code;
      } catch { /* */ }
    }
  }
  // Fallback: find + wc on common source extensions, skipping node_modules / venv / build
  const cmd = String.raw`find . \( -name node_modules -o -name .venv -o -name venv -o -name dist -o -name build -o -name .next -o -name target -o -name .git \) -prune -o -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' -o -name '*.rb' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.kt' -o -name '*.cs' -o -name '*.php' -o -name '*.swift' \) -print 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}'`;
  const n = parseInt(sh(cmd, cwd) || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

function detectAgeYears(cwd: string): number {
  const firstDate = sh("git log --reverse --format=%ci | head -1", cwd);
  if (!firstDate) return 0;
  const t = Date.parse(firstDate);
  if (!Number.isFinite(t)) return 0;
  const years = (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
  return Math.round(years * 10) / 10;
}

function detectLanguages(cwd: string): string {
  const counts: Record<string, number> = {};
  const exts: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript",
    js: "JavaScript", jsx: "JavaScript",
    py: "Python",
    rb: "Ruby",
    go: "Go",
    rs: "Rust",
    java: "Java", kt: "Kotlin",
    cs: "C#",
    php: "PHP",
    swift: "Swift",
  };
  const cmd = String.raw`find . \( -name node_modules -o -name .venv -o -name venv -o -name dist -o -name build -o -name .next -o -name target -o -name .git \) -prune -o -type f -name '*.*' -print 2>/dev/null`;
  const lines = sh(cmd, cwd).split("\n");
  for (const f of lines) {
    const ext = f.split(".").pop()?.toLowerCase();
    const lang = ext ? exts[ext] : undefined;
    if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 3).map(([l]) => l).join(", ") || "unknown";
}

function detectFrameworks(cwd: string): string {
  const out: string[] = [];
  if (anyExists(cwd, ["manage.py", "django/__init__.py"])) out.push("Django");
  if (fileExistsContaining(join(cwd, "package.json"), ["\"next\""])) out.push("Next.js");
  if (fileExistsContaining(join(cwd, "package.json"), ["\"fastify\""])) out.push("Fastify");
  if (fileExistsContaining(join(cwd, "package.json"), ["\"express\""])) out.push("Express");
  if (anyExists(cwd, ["config.ru", "Gemfile"]) && fileExistsContaining(join(cwd, "Gemfile"), ["rails"])) out.push("Rails");
  if (fileExistsContaining(join(cwd, "pyproject.toml"), ["fastapi"])) out.push("FastAPI");
  if (fileExistsContaining(join(cwd, "requirements.txt"), ["fastapi"])) out.push("FastAPI");
  if (fileExistsContaining(join(cwd, "requirements.txt"), ["flask"])) out.push("Flask");
  if (anyExists(cwd, ["pom.xml", "build.gradle", "build.gradle.kts"]) && fileExistsContaining(join(cwd, "pom.xml"), ["spring-boot"])) out.push("Spring Boot");
  if (anyExists(cwd, ["nuxt.config.ts", "nuxt.config.js"])) out.push("Nuxt");
  if (anyExists(cwd, ["svelte.config.js"])) out.push("Svelte");
  return out.join(", ") || "unknown";
}

function detectOrm(cwd: string): string {
  if (anyExists(cwd, ["prisma/schema.prisma"])) return "Prisma";
  if (anyExists(cwd, ["alembic.ini"])) return "SQLAlchemy + Alembic";
  if (fileExistsContaining(join(cwd, "pyproject.toml"), ["sqlalchemy"])) return "SQLAlchemy";
  if (fileExistsContaining(join(cwd, "requirements.txt"), ["sqlalchemy"])) return "SQLAlchemy";
  if (anyExists(cwd, ["manage.py"])) return "Django ORM";
  if (anyExists(cwd, ["config/database.yml"])) return "ActiveRecord";
  if (fileExistsContaining(join(cwd, "package.json"), ["\"typeorm\""])) return "TypeORM";
  if (fileExistsContaining(join(cwd, "package.json"), ["\"drizzle-orm\""])) return "Drizzle";
  if (fileExistsContaining(join(cwd, "pom.xml"), ["hibernate"])) return "Hibernate / JPA";
  return "none-detected";
}

function detectDb(cwd: string): string {
  const found = new Set<string>();
  const candidates = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", ".env", ".env.example", ".env.local"];
  for (const c of candidates) {
    const p = join(cwd, c);
    if (!exists(p)) continue;
    const t = readFileSync(p, "utf-8").toLowerCase();
    if (t.includes("postgres") || t.includes("psql")) found.add("Postgres");
    if (t.includes("mysql") || t.includes("mariadb")) found.add("MySQL");
    if (t.includes("mongo")) found.add("MongoDB");
    if (t.includes("redis")) found.add("Redis");
    if (t.includes("sqlite")) found.add("SQLite");
    if (t.includes("dynamodb")) found.add("DynamoDB");
    if (t.includes("clickhouse")) found.add("ClickHouse");
  }
  return found.size ? [...found].join(", ") : "none-detected";
}

function detectConnectorsConfigured(cwd: string): string {
  // doc-wiki / narai-primitives resolves connector config from BOTH locations:
  // user-global at ~/.connectors/config.yaml AND per-repo overlay at
  // ./.connectors/config.yaml. The overlay is what enterprise teams use to
  // pin per-project Jira/Confluence/DB endpoints; missing it here would
  // record EXTERNAL_CONNECTORS_ENABLED=none even when those connectors are
  // wired up for this repo.
  const ids = ["jira", "confluence", "github", "notion", "aws", "gcp", "db"];
  const enabled = new Set<string>();
  for (const path of [
    join(homedir(), ".connectors", "config.yaml"),
    join(cwd, ".connectors", "config.yaml"),
  ]) {
    if (!exists(path)) continue;
    const t = readFileSync(path, "utf-8");
    for (const id of ids) {
      if (new RegExp(`^\\s*${id}\\s*:`, "m").test(t)) enabled.add(id);
    }
  }
  return [...enabled].join(",");
}

// Safe-by-default flag normalization. PRIVATE gates whether public outputs
// (portfolio, public case study, social) sanitize company / service names —
// silently mis-parsing it could leak real internal names. Accept the common
// truthy/falsy strings and explicitly reject anything else.
function normalizePrivate(v: string): "true" | "false" {
  const s = v.trim().toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(s)) return "true";
  if (["false", "no", "n", "0", "off"].includes(s)) return "false";
  throw new Error(
    `PRIVATE must be true/false (or yes/no, y/n, 1/0). Got "${v}". Default is "true" for safety; explicit "false" required to allow real names in public outputs.`,
  );
}

async function maybePrompt(
  key: string,
  question: string,
  defaultValue: string,
  rl: ReturnType<typeof createInterface> | null,
): Promise<string> {
  if (process.env[key]) return process.env[key]!;
  if (!rl) return defaultValue;
  const ans = (await rl.question(`${question}\n  [${defaultValue}] `)).trim();
  return ans || defaultValue;
}

async function collect(cwd: string): Promise<Parameters> {
  const auto = {
    name: detectProjectName(cwd),
    loc: detectLoc(cwd),
    age: detectAgeYears(cwd),
    langs: detectLanguages(cwd),
    fw: detectFrameworks(cwd),
    orm: detectOrm(cwd),
    db: detectDb(cwd),
    connectors: detectConnectorsConfigured(cwd),
  };

  const tty = openControllingTty();
  const rl = tty ? createInterface({ input: tty.input, output: tty.output }) : null;
  const interactive = rl !== null;

  if (interactive) {
    console.log("\nDetected:");
    console.log(`  Project name: ${auto.name}`);
    console.log(`  LOC: ${auto.loc.toLocaleString()}`);
    console.log(`  Age: ${auto.age} years`);
    console.log(`  Languages: ${auto.langs}`);
    console.log(`  Frameworks: ${auto.fw}`);
    console.log(`  ORM: ${auto.orm}`);
    console.log(`  DB: ${auto.db}`);
    console.log(`  Connectors configured: ${auto.connectors || "none"}`);
    console.log("");
  } else {
    console.log(
      "(non-interactive — using defaults / env vars. To force prompts, run from a TTY or set env vars per the README.)",
    );
  }

  const PROJECT_NAME = await maybePrompt("PROJECT_NAME", "Project name (short generic label):", auto.name, rl);
  const PROJECT_DESCRIPTION = await maybePrompt(
    "PROJECT_DESCRIPTION",
    "One sentence on what the codebase does:",
    `a ${auto.fw !== "unknown" ? auto.fw : auto.langs} codebase (~${Math.round(auto.loc / 1000)}k LOC, ${auto.age} years old)`,
    rl,
  );
  const INTERNAL_TOOL_NAME = await maybePrompt(
    "INTERNAL_TOOL_NAME",
    "Name of the existing internal documentation tool you built (or 'none'):",
    "none",
    rl,
  );
  const INTERNAL_TOOL_LOCATION = INTERNAL_TOOL_NAME === "none"
    ? "none"
    : await maybePrompt(
        "INTERNAL_TOOL_LOCATION",
        "Path or URL to the existing tool:",
        "none",
        rl,
      );
  const EXTERNAL_CONNECTORS_ENABLED = await maybePrompt(
    "EXTERNAL_CONNECTORS_ENABLED",
    "External connectors enabled (comma-separated from {jira,confluence,github,notion,aws,gcp,db}):",
    auto.connectors,
    rl,
  );
  // Reworded to match what the flag actually controls. Public outputs (5.1, 5.2,
  // 5.4) are sanitized unconditionally — this flag only gates whether the
  // internal-pitch.md (5.3) gets generated. Phrasing "sanitize public outputs?"
  // misled users into thinking PRIVATE=true would prevent named artifacts; in
  // reality PRIVATE=true PRODUCES the NDA-only named artifact.
  const PRIVATE_RAW = await maybePrompt(
    "PRIVATE",
    "Generate internal-pitch.md (NDA-only, contains real service/team/ticket names — public outputs are always sanitized regardless)? (true/false, yes/no, y/n, 1/0):",
    "true",
    rl,
  );
  const PRIVATE = normalizePrivate(PRIVATE_RAW);
  const TICKET_SAMPLE_SIZE = await maybePrompt(
    "TICKET_SAMPLE_SIZE",
    "How many internal tickets to benchmark (5-10 recommended):",
    "5",
    rl,
  );

  if (rl) rl.close();

  return {
    PROJECT_NAME,
    PROJECT_DESCRIPTION,
    INTERNAL_TOOL_NAME,
    INTERNAL_TOOL_LOCATION,
    EXTERNAL_CONNECTORS_ENABLED,
    PRIVATE,
    TICKET_SAMPLE_SIZE,
    _detected: {
      loc: auto.loc,
      age_years: auto.age,
      languages: auto.langs,
      frameworks: auto.fw,
      orm: auto.orm,
      db: auto.db,
    },
  };
}

function renderPrompt(p: Parameters): string {
  // The Phase 1–5 template, with parameters substituted. This mirrors
  // launch/case-study-runner.md in the doc-wiki repo — kept inline so the
  // script is self-contained when curl'd into an arbitrary codebase.
  return `# doc-wiki case-study run — execute all 5 phases in order; write outputs to ./case-study-output/

## PARAMETERS (filled by case-study-init)

PROJECT_NAME: ${p.PROJECT_NAME}
PROJECT_DESCRIPTION: ${p.PROJECT_DESCRIPTION}
INTERNAL_TOOL_NAME: ${p.INTERNAL_TOOL_NAME}
INTERNAL_TOOL_LOCATION: ${p.INTERNAL_TOOL_LOCATION}
EXTERNAL_CONNECTORS_ENABLED: ${p.EXTERNAL_CONNECTORS_ENABLED || "none"}
PRIVATE: ${p.PRIVATE}
TICKET_SAMPLE_SIZE: ${p.TICKET_SAMPLE_SIZE}

Pre-detected codebase shape (use these in your output instead of re-measuring):
- repo_size_loc: ${p._detected.loc}
- repo_age_years: ${p._detected.age_years}
- languages: ${p._detected.languages}
- frameworks: ${p._detected.frameworks}
- orm: ${p._detected.orm}
- db: ${p._detected.db}

## PHASE 1 — Codebase inventory (no doc-wiki yet)

Produce ./case-study-output/01-inventory.json with these keys (most are already pre-detected above; fill in the rest by reading the codebase):

- repo_size_loc, repo_age_years, language_breakdown, frameworks_detected, orm_detected, db_detected (use pre-detected)
- service_count (top-level services/apps; 1 if not a monorepo)
- external_services_observed (any references to AWS/GCP/Jira/Confluence/Slack/etc. found in code or config)
- existing_documentation_observed: { readme_lines, in_code_comment_density_pct, markdown_doc_count, quality_subjective (1-5) }
- complexity_signals: { circular_dependencies_count, god_modules_count (files > 1000 LOC), schema_drift_observed }
- existing_internal_tool_summary (if INTERNAL_TOOL_NAME != "none"): { what_it_does, coverage_metric, last_updated, gaps_observed (3-5 items) }

Time budget: 30-60 minutes. Use Bash + Read; do not invoke doc-wiki yet.

## PHASE 2 — Build the doc-wiki

If doc-wiki is not installed, add the NarAI marketplace once and install (bare \`claude plugin install narailabs/doc-wiki\` doesn't work — the repo ships \`.claude-plugin/plugin.json\`, not a marketplace catalog):

  claude plugin marketplace add narailabs/narai-claude-plugins
  claude plugin install doc-wiki@narai

Run:
  /doc-wiki:init      # init now subsumes the old onboard step (stack/ORM/DB/services detection)
  /doc-wiki:atlas --dry-run

Read the dry-run output. If cost estimate exceeds $50, narrow with --scope <directory>. Then:
  /doc-wiki:atlas --max-cost 50

Collect into ./case-study-output/02-atlas.json:
- atlas_run_id, atlas_duration_minutes, atlas_cost_usd
- pages_generated, topics_covered, facets_per_topic_avg, mermaid_diagrams_generated
- references_inserted_in_claudemd
- orm_entities_mapped (if ORM detected)
- external_service_pages

Per-page index → ./case-study-output/02-pages-index.csv (path,title,type,sources,word_count).

Time budget: 1-3 hours.

## PHASE 3 — Comparison against existing internal tool

Skip if INTERNAL_TOOL_NAME == "none".

For each of these 8 axes, give a 1-paragraph judgment + one specific example:
1. Code coverage
2. Ecosystem coverage (Jira/Confluence/DB schemas)
3. ORM/DB linking
4. Progressive disclosure (summary-first index)
5. Drift detection
6. Cross-link density
7. Cited-synthesis queries
8. Maintenance cost

Save to ./case-study-output/03-comparison.json.

Then 3 specific anecdotes where doc-wiki caught something the existing tool missed (or vice versa). Save to ./case-study-output/03-anecdotes.json, each with: { axis, doc_wiki_artifact_path, existing_tool_artifact_path, description, impact_estimate }.

Time budget: 1-2 hours.

## PHASE 4 — Ticket benchmark

Select ${p.TICKET_SAMPLE_SIZE} real closed internal tickets from the last 6 months. Selection criteria:
- Fix was actually merged (PR closed)
- Fix touches 1-3 files (~5-200 LOC)
- A regression test was added in the fix PR
- Ticket is in this codebase, not a downstream service

IMPORTANT — use the **two-workspace pattern** from benchmark/PLAN.md, not a single-tree restore. The wiki / CLAUDE.md references generated in Phase 2 must NOT be present during the baseline runs and MUST be present during the with-doc-wiki runs, so isolation comes from separate clones, not from in-place restore (which either fails on the uncommitted wiki or wipes it).

For each ticket × condition, create a fresh workspace:

  for each ticket:
    BASELINE_DIR=/tmp/case-study/<ticket_id>-baseline
    rm -rf "$BASELINE_DIR" && mkdir -p "$BASELINE_DIR" && cd "$BASELINE_DIR"
    git clone --depth 100 <internal-repo-url> .
    git fetch --depth 500 origin <fix_commit> 2>/dev/null || git fetch --unshallow
    git checkout <fix_commit>^1
    git checkout <fix_commit> -- <test_file_path>      # apply test patch
    git reset HEAD <test_file_path> 2>/dev/null || true
    # install deps, run claude -p "Fix this ticket: <title>\\n<body>"
    # run the named test; record success/duration/tokens/cost

    WDW_DIR=/tmp/case-study/<ticket_id>-with-docwiki
    rm -rf "$WDW_DIR" && mkdir -p "$WDW_DIR" && cd "$WDW_DIR"
    git clone --depth 100 <internal-repo-url> .
    git fetch --depth 500 origin <fix_commit> 2>/dev/null || git fetch --unshallow
    git checkout <fix_commit>^1
    git checkout <fix_commit> -- <test_file_path>
    git reset HEAD <test_file_path> 2>/dev/null || true
    /doc-wiki:init && /doc-wiki:atlas --max-cost 30 --scope <relevant-dir>
    # install deps, run claude -p with the same prompt
    # run the named test; record same fields

The atlas runs once per (ticket, with-doc-wiki) workspace — yes, this means atlas spend stacks. That matches the canonical benchmark/PLAN.md methodology (each condition is a fresh clone; the with-doc-wiki branch builds the wiki from scratch).

Save run-level → \`$REPO_ROOT/case-study-output/04-ticket-bench.csv\` with columns:
ticket_id, condition, success, duration_s, tokens_in, tokens_out, cost_usd, fix_path, test_path, notes

Save summary → \`$REPO_ROOT/case-study-output/04-summary.json\` with: baseline_pass_rate, with_docwiki_pass_rate, delta_pp, median durations, total costs.

(Capture \`REPO_ROOT="$PWD"\` BEFORE entering the per-ticket loop. The two-workspace blocks \`cd\` into /tmp clones, so relative \`./case-study-output/...\` paths would otherwise resolve to the wrong directory.)

Time budget: ~1 hour per ticket × ${p.TICKET_SAMPLE_SIZE} tickets.

## PHASE 5 — Generate deliverables

Produce four documents from the 4 phases above. **All deliverable paths are absolute under \`$REPO_ROOT/case-study-output/\`** — the same reason the Phase 4 CSV/summary use \`$REPO_ROOT\` (after the per-ticket loop, the session is in /tmp/case-study/<last-ticket>-with-docwiki, so relative paths would land there). \`cd "$REPO_ROOT"\` before authoring, or write each path with the explicit \`$REPO_ROOT\` prefix.

### 5.1 \`$REPO_ROOT/case-study-output/portfolio.md\` (~600 words, sanitized)
Public-shareable. Replace company name with "${p.PRIVATE === "true" ? "<COMPANY_TYPE>" : ""}". Lead with the benchmark headline + methodology + the OSS verification pointer (https://github.com/narailabs/doc-wiki/tree/main/benchmark). Include one anonymized anecdote. Close with the OSS repo link.

### 5.2 \`$REPO_ROOT/case-study-output/case-study-public.md\` (~1500 words, sanitized)
Same shape as portfolio but methodology-heavy. Includes 2 anecdotes, a sanitized Mermaid architecture diagram, and a reproducibility pointer to benchmark/PUBLISH.md.

### 5.3 \`$REPO_ROOT/case-study-output/internal-pitch.md\` (~800 words, NOT for external sharing)
${p.PRIVATE === "true"
    ? `Real names, real numbers, full detail. Migration plan (which services first, decision-gate at end of 4-week pilot), cost projection at scale, the ask (sanctioned 4-week pilot). Keep this on your internal wiki only.`
    : `SKIPPED — PRIVATE=false explicitly opts out of generating any artifact with real names. Only the sanitized public outputs (5.1, 5.2, 5.4) are produced. If you change your mind, re-run with PRIVATE=true.`}

### 5.4 \`$REPO_ROOT/case-study-output/social/\` — four ready-to-post files, all sanitized
- linkedin.md (~300 words)
- x-thread.md (5-7 tweets)
- reddit-experienced-devs.md (~800 words, candid)
- devto-deepdive.md (~2000 words)

## Sanitization rules (apply to 5.1, 5.2, 5.4 — UNCONDITIONALLY, regardless of PRIVATE)

The public outputs (portfolio, public case study, social variants) are ALWAYS sanitized. The PRIVATE flag only controls whether the internal pitch (5.3) gets generated; it does not relax sanitization on the public outputs.

- No company name, no team names, no employee names other than yours
- No specific customer names
- Internal ticket IDs paraphrased into general patterns
- Service names replaced with SERVICE_A, SERVICE_B, ...
- No screenshots of internal tools / Jira / Confluence
- Architecture diagrams: replace service/db names with placeholders
- Numbers kept (LOC, ages, percentages)
- Tech stack kept (Django, Postgres, etc.)

When in doubt, replace.

## Output checklist

- [ ] 01-inventory.json
- [ ] 02-atlas.json
- [ ] 02-pages-index.csv
- [ ] 03-comparison.json (if INTERNAL_TOOL_NAME != "none")
- [ ] 03-anecdotes.json
- [ ] 04-ticket-bench.csv
- [ ] 04-summary.json
- [ ] portfolio.md
${p.PRIVATE === "true" ? "- [ ] internal-pitch.md\n" : "- [~] internal-pitch.md SKIPPED (PRIVATE=false)\n"}- [ ] case-study-public.md
- [ ] social/{linkedin,x-thread,reddit-experienced-devs,devto-deepdive}.md
- [ ] grep all public outputs for company/team/customer names — none should appear


## Final summary to stdout

After all 5 phases + checklist, print: total wall time, total atlas + Claude spend, headline numbers (baseline/with-doc-wiki/delta), the 3 anecdotes (one line each), where each deliverable is located, one sentence on what surprised you the most.
`;
}

function ensureGitignored(cwd: string, dirRel: string): void {
  const giPath = join(cwd, ".gitignore");
  const want = dirRel.endsWith("/") ? dirRel : `${dirRel}/`;
  if (exists(giPath)) {
    const c = readFileSync(giPath, "utf-8");
    if (c.split("\n").some((l) => l.trim() === want.replace(/\/$/, "") || l.trim() === want)) return;
    appendFileSync(giPath, `\n# scaffolded by doc-wiki/launch/case-study-init.ts\n${want}\n`);
  } else {
    writeFileSync(giPath, `# scaffolded by doc-wiki/launch/case-study-init.ts\n${want}\n`);
  }
}

async function main(): Promise<void> {
  const cwd = resolve(process.cwd());

  // Sanity check: are we inside a git repo?
  if (!exists(join(cwd, ".git"))) {
    console.error("✗ No .git here. Run this from the root of the codebase you want to document.");
    process.exit(1);
  }

  console.log(`case-study-init — scaffolding case-study-output/ in ${cwd}`);

  const outDir = join(cwd, "case-study-output");
  if (exists(outDir)) {
    console.warn(`! case-study-output/ already exists — overwriting PARAMETERS.json and PROMPT.md only`);
  }
  mkdirSync(outDir, { recursive: true });

  const params = await collect(cwd);

  // Persist parameters
  writeFileSync(
    join(outDir, "PARAMETERS.json"),
    JSON.stringify(params, null, 2),
  );

  // Write the rendered prompt
  const prompt = renderPrompt(params);
  writeFileSync(join(outDir, "PROMPT.md"), prompt);

  // Make output dir contents private even if user's .gitignore is permissive
  writeFileSync(
    join(outDir, ".gitignore"),
    "# Default-private: nothing in this directory should ever land in git\n*\n!.gitignore\n",
  );

  // Add case-study-output/ to project .gitignore (best-effort)
  ensureGitignored(cwd, "case-study-output");

  // Final summary
  console.log("\n✓ Scaffolded:");
  console.log(`   case-study-output/PARAMETERS.json   (${Object.keys(params).length - 1} fields)`);
  console.log(`   case-study-output/PROMPT.md         (${prompt.split("\n").length} lines)`);
  console.log(`   case-study-output/.gitignore        (deny-all)`);
  console.log(`   .gitignore                          (case-study-output/ added)`);
  console.log("\nDetected for this codebase:");
  console.log(`   ${params._detected.loc.toLocaleString()} LOC, ${params._detected.age_years} years old, ${params._detected.languages}`);
  console.log(`   frameworks=${params._detected.frameworks}  orm=${params._detected.orm}  db=${params._detected.db}`);
  console.log("\nNext: open case-study-output/PROMPT.md and paste its contents into a Claude Code");
  console.log("session opened on this codebase. The 5 phases run sequentially (~5-15 hours total).\n");
}

main().catch((e) => {
  console.error("✗ case-study-init failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
