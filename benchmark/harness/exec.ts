import { execFile } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOpts {
  timeoutMs?: number;
  /** Fully REPLACES the child environment — spread process.env yourself if PATH/HOME are needed. */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** Single injectable boundary for every external process (gh, docker, git, bash). Never rejects on nonzero exit. */
export type Runner = (cmd: string, args: readonly string[], opts?: ExecOpts) => Promise<ExecResult>;

export const realRunner: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      {
        timeout: opts.timeoutMs ?? 0,
        env: opts.env ?? process.env,
        cwd: opts.cwd,
        maxBuffer: 64 * 1024 * 1024, // exceeded → code=1 with truncated stdout; no separate signal
      },
      (err, stdout, stderr) => {
        let code = 0;
        if (err !== null) {
          const c = (err as NodeJS.ErrnoException & { code?: unknown }).code;
          code = typeof c === "number" ? c : 1;
        }
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
