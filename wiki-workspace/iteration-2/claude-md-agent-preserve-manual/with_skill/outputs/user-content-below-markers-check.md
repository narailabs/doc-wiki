# User content BELOW `<!-- wiki-managed: end -->` — preservation check

Region examined: every byte of the file strictly after the end marker.

## Hashes (sha256)

| State  | Bytes | sha256 |
|--------|-------|--------|
| Before | 83    | `a22d3512e3934d473dd75baf970521bbf4f25fa785fdfaa2abafcadd4329dafe` |
| After  | 83    | `a22d3512e3934d473dd75baf970521bbf4f25fa785fdfaa2abafcadd4329dafe` |

**Identical.** The "Manual footer" heading and following prose the user wrote below the markers were preserved byte-for-byte.

## Unified diff (`diff -u` before vs. after)

```diff
(empty — diff exit code 0, no output)
```

## Before region contents

```


## Manual footer

Another manual block the user wrote below the managed section.
```

## After region contents

```


## Manual footer

Another manual block the user wrote below the managed section.
```

## Verdict

PASS — `shasum` and `diff -u` both confirm the post-marker region is unchanged.
