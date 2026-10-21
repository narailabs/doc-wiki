# Invalid Granularity Check — W1 Fix Verification (Assertion 6)

Demonstrates that the W1 fix is working: `--since 1z` now exits with code 2
and writes a human-readable error to stderr, with no output on stdout.

## Command run

```
node event_logger.js stats --wiki-root /tmp/eval-i8-stats-since-wiki --since 1z
```

## Observed behavior (iteration-8, W1 fixed)

| Observable        | Value                                                                        |
|-------------------|------------------------------------------------------------------------------|
| exit code         | **2**                                                                        |
| stdout            | **(empty)**                                                                  |
| stderr            | `[event_logger] error: --since value "1z" is not a valid relative duration (e.g. 7d, 24h, 15m) or absolute ISO timestamp (YYYY-MM-DD...)` |

## Where the fix lives

`event_logger.js` lines 487–494 (and the corresponding `.ts` source):

```javascript
if (args.since !== null && args.since !== undefined) {
    const isRelative = /^\d+[dhm]$/.test(args.since);
    const isAbsolute = /^\d{4}-\d{2}-\d{2}/.test(args.since);
    if (!isRelative && !isAbsolute) {
        process.stderr.write(`[event_logger] error: --since value ${JSON.stringify(args.since)} ...`);
        return 2;
    }
}
```

The validation runs at the CLI boundary — before `parseRelativeSince()` or
any file I/O — so:
- `1z` does not match `^\d+[dhm]$` (granularity "z" is not d/h/m)
- `1z` does not match `^\d{4}-\d{2}-\d{2}` (not an absolute ISO timestamp)
- The function returns 2 immediately, writing the error to stderr only

## Contrast with iteration-7 (before fix)

In iteration-7 the same invocation:
- exit code: 0
- stdout: all 12 events (no filter applied — silent fallback)
- stderr: empty

This was the exact "silent fallback to no filter" the assertion calls a failure.

## Conclusion

W1 fix is confirmed working. Assertion 6: **PASS** (FLIPPED from FAIL in iter-7)
