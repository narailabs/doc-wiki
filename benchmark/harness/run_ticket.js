import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import { loadState, nextPairs, runKey, saveState, setRun } from "./bench_checkpoint.js";
import { sessionRunArgs } from "./docker_args.js";
import { realRunner } from "./exec.js";
import { loadRepoConfig } from "./repo_config.js";
import { buildPrompt, classifySession } from "./session.js";
function readOut(outDir, name) {
    const p = join(outDir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
}
export async function runBatch(opts) {
    const ticketsFile = JSON.parse(readFileSync(opts.ticketsPath, "utf8"));
    const runnable = ticketsFile.tickets.filter((t) => t.excluded === undefined &&
        (t.calibration === undefined ||
            (t.calibration.paths_stable && t.calibration.tests_fail_on_base && t.calibration.tests_pass_on_fix)));
    const byIssue = new Map(runnable.map((t) => [t.issue, t]));
    const stateFile = join(opts.runsRoot, opts.cfg.id, "state.json");
    const state = loadState(stateFile, opts.cfg.id);
    const summary = { ran: 0, rateLimited: 0, errors: 0 };
    const work = nextPairs(state, runnable.map((t) => t.issue), opts.batch);
    for (const item of work) {
        const ticket = byIssue.get(item.issue);
        if (ticket === undefined)
            continue;
        for (const arm of item.arms) {
            const outDir = resolve(opts.runsRoot, opts.cfg.id, String(item.issue), arm);
            mkdirSync(outDir, { recursive: true });
            writeFileSync(join(outDir, "prompt.txt"), buildPrompt(ticket));
            setRun(state, item.issue, arm, { status: "running", started_at: new Date().toISOString() });
            saveState(stateFile, state);
            const dockerArgs = sessionRunArgs({
                image: opts.image,
                outDir,
                bareDir: opts.bareDir,
                wikiDir: arm === "wiki" ? opts.wikiDir : undefined,
                baseCommit: ticket.base_commit,
                model: opts.model,
                maxTurns: opts.maxTurns,
                install: opts.cfg.install,
                timeoutSec: opts.timeoutSec,
            });
            const exec = await opts.runner("docker", dockerArgs, { timeoutMs: opts.timeoutSec * 1000 });
            const result = classifySession(readOut(outDir, "result.json"), exec.code !== 0 ? exec.code : Number(readOut(outDir, "exit_code").trim() || "0"), readOut(outDir, "stderr.log") + exec.stderr);
            const finished = new Date().toISOString();
            if (result.kind === "ok") {
                setRun(state, item.issue, arm, {
                    status: "ran", started_at: state.runs[runKey(item.issue, arm)]?.started_at,
                    finished_at: finished, cost_usd: result.costUsd, session_id: result.sessionId,
                });
                summary.ran += 1;
            }
            else if (result.kind === "rate-limited") {
                setRun(state, item.issue, arm, { status: "rate-limited", finished_at: finished, detail: result.detail });
                saveState(stateFile, state);
                summary.rateLimited += 1;
                process.stderr.write(`rate limit hit (${result.detail ?? ""}) — stopping batch; resume with the same command\n`);
                return summary;
            }
            else {
                setRun(state, item.issue, arm, { status: "error", finished_at: finished, detail: result.detail });
                summary.errors += 1;
            }
            saveState(stateFile, state);
        }
    }
    return summary;
}
export async function main(argv) {
    const { help, values } = parseFlags(argv, {
        "--repo": "repo", "--batch": "batch", "--max-turns": "maxTurns",
        "--timeout-sec": "timeoutSec", "--model": "model",
        "--bare-dir": "bareDir", "--wiki-dir": "wikiDir", "--image": "image",
    });
    if (help || values.repo === undefined) {
        process.stderr.write("usage: benchmark run --repo <id> [--batch 10] [--max-turns 80] [--timeout-sec 1800] [--model claude-sonnet-4-6] [--bare-dir d] [--wiki-dir d] [--image i]\n");
        return help ? 0 : 2;
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN === undefined) {
        process.stderr.write("CLAUDE_CODE_OAUTH_TOKEN is not set (run: claude setup-token)\n");
        return 2;
    }
    const repo = String(values.repo);
    const cfg = loadRepoConfig(join("benchmark", "repos", `${repo}.yaml`));
    const batch = values.batch === undefined ? 10 : Number(values.batch);
    const maxTurns = values.maxTurns === undefined ? 80 : Number(values.maxTurns);
    const timeoutSec = values.timeoutSec === undefined ? 1800 : Number(values.timeoutSec);
    for (const [name, v] of [["--batch", batch], ["--max-turns", maxTurns], ["--timeout-sec", timeoutSec]]) {
        if (!Number.isInteger(v) || v <= 0) {
            process.stderr.write(`${name} must be a positive integer\n`);
            return 2;
        }
    }
    const summary = await runBatch({
        cfg,
        ticketsPath: join("benchmark", "tickets", `${repo}.json`),
        runsRoot: join("benchmark", "runs"),
        bareDir: String(values.bareDir ?? resolve("benchmark", "wiki-cache", `${repo}.git`)),
        wikiDir: String(values.wikiDir ?? resolve("benchmark", "wiki-cache", repo, "overlay")),
        image: String(values.image ?? `docwiki-bench-${repo}`),
        model: String(values.model ?? "claude-sonnet-4-6"),
        maxTurns, batch, timeoutSec,
        runner: realRunner,
    });
    process.stderr.write(`ran=${summary.ran} rate-limited=${summary.rateLimited} errors=${summary.errors}\n`);
    return summary.errors > 0 ? 1 : 0;
}
