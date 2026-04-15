/**
 * _agent_cli.ts — shared CLI argument parser for source agents.
 *
 * G-AGENT-CLI-DRY: the six source agents (github, notion, aws,
 * confluence, jira, gcp) all hand-rolled the same ~45-line arg parser.
 * This helper centralises the parser, keyed by an explicit set of
 * valid flag names so unknown flags still throw (the original
 * behavior). Each caller keeps its own help-text and post-parse
 * validation (e.g. JSON-shaped `--params`).
 */

/** Parsed result. Keys match the lowercase flag names. */
export interface ParsedAgentArgs {
  /** The `<name>` portion of `--action <name>` or `--action=<name>`. */
  action?: string;
  /** The `<json>` portion of `--params <json>` or `--params=<json>`. */
  params?: string;
  /** `true` when `-h` / `--help` was passed. */
  help?: boolean;
}

/** Closed set of valid flag names (without the leading `--`). */
export interface FlagSpec {
  readonly flags: readonly string[];
}

/**
 * Parse `argv` against a closed set of valid flag names.
 *
 * Accepted shapes:
 *   --flag value
 *   --flag=value
 *   -h / --help
 *
 * Throws on any positional, bare `-x`, or unrecognised `--name`.
 */
export function parseAgentArgs(
  argv: readonly string[],
  spec: FlagSpec,
): ParsedAgentArgs {
  const valid = new Set(spec.flags);
  const out: ParsedAgentArgs = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) {
      i++;
      continue;
    }
    if (a === "-h" || a === "--help") {
      out.help = true;
      i++;
      continue;
    }
    if (!a.startsWith("--")) {
      throw new Error(`unrecognized argument: ${a}`);
    }
    let name: string;
    let value: string | undefined;
    const eq = a.indexOf("=");
    if (eq >= 0) {
      name = a.slice(2, eq);
      value = a.slice(eq + 1);
      i++;
    } else {
      name = a.slice(2);
      value = argv[i + 1];
      i += 2;
    }
    if (!valid.has(name)) {
      throw new Error(`unrecognized argument: --${name}`);
    }
    // Each agent only uses `action` and `params`; assign generically.
    if (name === "action") {
      out.action = value ?? "";
    } else if (name === "params") {
      out.params = value ?? "";
    }
  }
  return out;
}
