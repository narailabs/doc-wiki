/** docker run argv for one agent session. The OAuth token is passed by NAME only (-e VAR) so it never appears in argv/process listings. */
export function sessionRunArgs(s) {
    const args = [
        "run", "--rm",
        "--cap-add=NET_ADMIN",
        "--stop-timeout", "10",
        "-v", `${s.bareDir}:/bare:ro`,
        "-v", `${s.outDir}:/out`,
        "-e", "CLAUDE_CODE_OAUTH_TOKEN",
        "-e", `BENCH_BASE_COMMIT=${s.baseCommit}`,
        "-e", `BENCH_MODEL=${s.model}`,
        "-e", `BENCH_MAX_TURNS=${s.maxTurns}`,
        "-e", `BENCH_INSTALL=${s.install.join(" && ")}`,
    ];
    if (s.wikiDir !== undefined)
        args.push("-v", `${s.wikiDir}:/wiki:ro`);
    args.push(s.image, "session");
    return args;
}
export function gradeRunArgs(g) {
    return [
        "run", "--rm",
        "-v", `${g.bareDir}:/bare:ro`,
        "-v", `${g.outDir}:/out`,
        "-e", `BENCH_BASE_COMMIT=${g.baseCommit}`,
        "-e", `BENCH_FIX_COMMIT=${g.fixCommit}`,
        "-e", `BENCH_TEST_FILES=${g.testFiles.join(" ")}`,
        "-e", `BENCH_TEST_COMMAND=${g.testCommand}`,
        "-e", `BENCH_RETRIES=${g.retries}`,
        g.image, "grade",
    ];
}
export function buildImageArgs(tag, toolchain, contextDir) {
    return ["build", "-t", tag, "--build-arg", `TOOLCHAIN=${toolchain}`, contextDir];
}
