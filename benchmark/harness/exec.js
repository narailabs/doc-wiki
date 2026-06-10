import { execFile } from "node:child_process";
export const realRunner = (cmd, args, opts = {}) => new Promise((resolve) => {
    execFile(cmd, [...args], {
        timeout: opts.timeoutMs ?? 0,
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
