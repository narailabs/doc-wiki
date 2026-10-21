import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const workDir = path.resolve(here, "..", "..", "work");
const eventsPath = path.join(workDir, "log", "events.jsonl");
const cliResolution = JSON.parse(fs.readFileSync(path.join(here, "cli-resolution.json"), "utf-8"));

function append(runIndex, dispatch) {
  const entry = {
    op: "ingest",
    timestamp: new Date().toISOString(),
    run: runIndex,
    consumer: "doc-wiki",
    source: "https://stub-confluence.local/wiki/spaces/PROJ/pages/1",
    dispatch_steps: dispatch.results.map((r) => ({
      step: r.step,
      connector: r.connector,
      action: r.action,
      status: r.envelope?.status ?? (r.error ? "error" : "unknown"),
      data_keys: r.envelope?.data ? Object.keys(r.envelope.data) : [],
      error_code: r.envelope?.error_code ?? r.error?.code ?? null,
    })),
    resolved_cli: cliResolution.resolvedPath,
  };
  fs.appendFileSync(eventsPath, JSON.stringify(entry) + "\n");
}

const r1 = JSON.parse(fs.readFileSync(path.join(here, "dispatch-result.json"), "utf-8")).result;
const r2 = JSON.parse(fs.readFileSync(path.join(here, "dispatch-result-2.json"), "utf-8")).result;
append(1, r1);
append(2, r2);
console.log("appended 2 ingest events to", eventsPath);
