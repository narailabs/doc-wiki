/**
 * Shared argv flag parser for wiki scripts.
 *
 * Every Python argparse-style flag we use across these scripts follows the
 * same tiny grammar:
 *   --flag value    (space-separated)
 *   --flag=value    (equals-separated)
 *   -h / --help     (boolean, no value)
 *
 * This helper factors out the hand-rolled loop that was duplicated across
 * parse_config/event_logger/graph_ops/mermaid_lint/cache_manager. Scripts
 * with their own subcommand dispatch still handle the leading positional
 * themselves and only use `parseFlags` for the remaining flags.
 *
 * Design notes:
 *   - The spec is a plain `{ "--flag": "fieldName" }` map. The value is
 *     always captured as a string (or `true` for boolean-style `--help`);
 *     callers coerce to number/null/etc. as needed.
 *   - Unknown `--flag` throws with the exact Python-ish "unrecognized
 *     argument" error message so stderr messages stay stable across ports.
 *   - Non-`--` tokens raise immediately — this helper is for flag-only
 *     parsing; subcommand dispatch stays in the calling script.
 */
export type FlagSpec = Readonly<Record<string, string>>;

export interface ParsedFlags {
  /** Whether the user passed `-h` or `--help`. */
  help: boolean;
  /** Captured flag values, keyed by the spec's field name. */
  values: Record<string, string | true>;
}

/**
 * Parse a list of argv tokens against a flag spec.
 *
 * @param argv Tokens to parse (typically `process.argv.slice(2)` or a slice
 *   thereof after the caller has peeled off a leading subcommand).
 * @param spec Map from `--flag` string to the key under which the captured
 *   value should be stored in the result. Keys must begin with `--`.
 * @returns `{ help, values }`. `help` is true if `-h` or `--help` appeared.
 *   `values` contains one entry per `--flag` that was actually supplied.
 * @throws {Error} When an unknown flag or bare positional is encountered.
 */
export function parseFlags(
  argv: readonly string[],
  spec: FlagSpec,
): ParsedFlags {
  const values: Record<string, string | true> = {};
  let help = false;

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined) {
      i++;
      continue;
    }
    if (token === "-h" || token === "--help") {
      help = true;
      i++;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`unrecognized argument: ${token}`);
    }

    let flag: string;
    let value: string | undefined;
    const eq = token.indexOf("=");
    if (eq >= 0) {
      flag = token.slice(0, eq);
      value = token.slice(eq + 1);
      i++;
    } else {
      flag = token;
      value = argv[i + 1];
      i += 2;
    }

    const fieldName = spec[flag];
    if (fieldName === undefined) {
      throw new Error(`unrecognized argument: ${flag}`);
    }
    values[fieldName] = value ?? "";
  }

  return { help, values };
}
