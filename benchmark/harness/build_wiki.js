import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import { realRunner } from "./exec.js";
import { loadRepoConfig } from "./repo_config.js";
export function validateWikiCommit(wikiCommit) {
    if (wikiCommit === "") {
        throw new Error("wiki_commit is not set in the repo yaml. Rule: parent of the oldest eligible ticket's base_commit (see spec).");
    }
}
/** Contamination guard: the wiki must be built strictly before every ticket's base commit. */
export async function checkWikiIsAncestor(runner, bareDir, wikiCommit, baseCommits) {
    for (const base of baseCommits) {
        const r = await runner("git", ["-C", bareDir, "merge-base", "--is-ancestor", wikiCommit, base]);
        if (r.code !== 0) {
            throw new Error(`contamination guard: wiki_commit ${wikiCommit} is not an ancestor of base_commit ${base}`);
        }
    }
}
export function wikiSessionArgs(s) {
    return [
        "run", "--rm",
        "--name", s.name,
        "-v", `${s.bareDir}:/bare:ro`,
        "-v", `${s.outDir}:/out`,
        "-v", `${s.pluginDir}:/plugin:ro`,
        "-e", "CLAUDE_CODE_OAUTH_TOKEN",
        "-e", `BENCH_BASE_COMMIT=${s.wikiCommit}`,
        "-e", `BENCH_MODEL=${s.model}`,
        s.image, "wiki-build",
    ];
}
export async function main(argv) {
    const { help, values } = parseFlags(argv, {
        "--repo": "repo", "--plugin-dir": "pluginDir", "--image": "image", "--bare-dir": "bareDir", "--model": "model",
    });
    if (help || values.repo === undefined) {
        process.stderr.write("usage: benchmark build-wiki --repo <id> [--plugin-dir .] [--image i] [--bare-dir d] [--model m]\n");
        return help ? 0 : 2;
    }
    if (process.env["CLAUDE_CODE_OAUTH_TOKEN"] === undefined) {
        process.stderr.write("CLAUDE_CODE_OAUTH_TOKEN is not set (run: claude setup-token)\n");
        return 2;
    }
    const repo = String(values.repo);
    const cfg = loadRepoConfig(join("benchmark", "repos", `${repo}.yaml`));
    validateWikiCommit(cfg.wiki_commit);
    const bareDir = String(values.bareDir ?? resolve("benchmark", "wiki-cache", `${repo}.git`));
    // Mount the repo's wiki-cache dir; the overlay lands at <outDir>/overlay (run_ticket's wikiDir).
    const outDir = resolve("benchmark", "wiki-cache", repo);
    // Contamination guard runs against the mined tickets when they exist.
    const ticketsPath = join("benchmark", "tickets", `${repo}.json`);
    try {
        const tickets = JSON.parse(readFileSync(ticketsPath, "utf8")).tickets;
        await checkWikiIsAncestor(realRunner, bareDir, cfg.wiki_commit, tickets.filter((t) => t.excluded === undefined).map((t) => t.base_commit));
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
        process.stderr.write(`warning: ${ticketsPath} not found — ancestor guard skipped (mine first for full validation)\n`);
    }
    mkdirSync(outDir, { recursive: true });
    const containerName = `bench-${repo}-wiki-build`;
    // Clear stale crash leftovers and prevent --name collisions; result ignored.
    await realRunner("docker", ["rm", "-f", containerName]);
    const args = wikiSessionArgs({
        image: String(values.image ?? `docwiki-bench-${repo}`),
        bareDir,
        outDir,
        pluginDir: resolve(String(values.pluginDir ?? ".")),
        wikiCommit: cfg.wiki_commit,
        model: String(values.model ?? "claude-sonnet-4-6"),
        name: containerName,
    });
    const r = await realRunner("docker", args, { timeoutMs: 4 * 60 * 60 * 1000 });
    // Host-side timeout SIGKILLs the docker CLI, not the container — reap it so an
    // orphan can't keep burning quota (full egress + token) or corrupt /out on a re-run.
    if (r.code !== 0)
        await realRunner("docker", ["rm", "-f", containerName]);
    process.stderr.write(r.stderr);
    return r.code;
}
