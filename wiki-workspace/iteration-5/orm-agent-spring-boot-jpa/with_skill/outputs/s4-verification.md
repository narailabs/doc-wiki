# S4 verification — PASS

## File-path form works

Command used: `--output-json ./detected-entities.json` (positional path, not stdout redirect).

Evidence:

- `detected-entities.json` exists as a file on disk (not captured via `>`).
- stderr contains the breadcrumb: `orm_detect: wrote JSON to ./detected-entities.json`.
- stdout is empty (the markdown went to `--output-markdown` and JSON went to disk directly).

## Before S4

The only way to capture the JSON was `orm_detect.js --output-json > file.json`, which looked like a CLI bug (boolean flag "missing" its value) and was fragile if stderr was also captured.
