import { join } from "node:path";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import { buildImageArgs } from "./docker_args.js";
import { realRunner } from "./exec.js";
import { loadRepoConfig } from "./repo_config.js";
const DOCKER_CONTEXT = join("benchmark", "harness", "docker");
/** docker build argv for a repo's bench image — bakes system_packages via EXTRA_APT. */
export function imageBuildArgs(cfg) {
    const tag = `docwiki-bench-${cfg.id}`;
    const toolchain = cfg.toolchain[0] ?? "node:22";
    return buildImageArgs(tag, toolchain, DOCKER_CONTEXT, cfg.system_packages);
}
export async function main(argv) {
    const { help, values } = parseFlags(argv, { "--repo": "repo" });
    if (help || values.repo === undefined) {
        process.stderr.write("usage: benchmark build-image --repo <id>\n");
        return help ? 0 : 2;
    }
    const repo = String(values.repo);
    const cfg = loadRepoConfig(join("benchmark", "repos", `${repo}.yaml`));
    const args = imageBuildArgs(cfg);
    const r = await realRunner("docker", args, { timeoutMs: 30 * 60 * 1000 });
    process.stderr.write(r.stdout);
    process.stderr.write(r.stderr);
    return r.code;
}
