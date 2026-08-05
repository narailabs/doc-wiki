# S4 check — PASS

## Evidence

- Command used: `--output-json ./detected-entities.json` (path argument, NOT stdout redirect)
- `detected-entities.json` exists as a real file (1094 bytes, written by the script)
- stderr breadcrumb: `orm_detect: wrote JSON to ./detected-entities.json`
- stdout is empty (the JSON did NOT land there)

## Before (iteration-4)

`--output-json` was a boolean flag that printed to stdout. The only way to capture the JSON was `--output-json > file.json`, which was fragile (stderr mixed in, and it looked like a positional-arg bug).

## After (iteration-5)

`--output-json [<path>]` accepts an optional path argument. Parser behaviour:

- `--output-json` alone → boolean, prints to stdout (legacy).
- `--output-json ./path.json` → writes to `./path.json` (dirs created as needed).
- `--output-json=./path.json` (eq-form) → same.

The file path form prints a breadcrumb to stderr so scripted runs have a visible confirmation. Stdout stays free for status messages or markdown output.
