import { execFile } from "node:child_process";
export const realRunner = (cmd, args, opts = {}) => new Promise((resolve) => {
    execFile(cmd, [...args], {
        timeout: opts.timeoutMs ?? 0,
        // SIGKILL, not the default SIGTERM: `docker run` catches SIGTERM and proxies it to the
        // container; a container whose PID1 defers TERM (the session entrypoint while claude runs)
        // keeps the CLI alive, so the await would block for the container's full lifetime instead
        // of the deadline. SIGKILL guarantees resolution at timeoutMs; the orphaned container is
        // reaped by name by the caller (run_ticket reaps on code !== 0).
        killSignal: "SIGKILL",
        env: opts.env ?? process.env,
        cwd: opts.cwd,
        maxBuffer: 64 * 1024 * 1024, // exceeded → code=1 with truncated stdout; no separate signal
    }, (err, stdout, stderr) => {
        let code = 0;
        if (err !== null) {
            const c = err.code;
            code = typeof c === "number" ? c : 1;
        }
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
});
