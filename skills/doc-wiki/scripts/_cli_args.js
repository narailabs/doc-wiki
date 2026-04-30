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
export function parseFlags(argv, spec) {
    const values = {};
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
        let flag;
        let value;
        const eq = token.indexOf("=");
        if (eq >= 0) {
            flag = token.slice(0, eq);
            value = token.slice(eq + 1);
            i++;
        }
        else {
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
