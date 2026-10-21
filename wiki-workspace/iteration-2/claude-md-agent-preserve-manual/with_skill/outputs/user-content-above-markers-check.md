# User content ABOVE `<!-- wiki-managed: start -->` — preservation check

Region examined: every byte of the file strictly before the start marker.

## Hashes (sha256)

| State  | Bytes | sha256 |
|--------|-------|--------|
| Before | 145   | `95b9698472b81b1ede6acd59437cf1d118dbe5c4b81320636f9495153736ab53` |
| After  | 145   | `95b9698472b81b1ede6acd59437cf1d118dbe5c4b81320636f9495153736ab53` |

**Identical.** The user's custom header, prose, and bullet list above the managed markers were preserved byte-for-byte.

## Unified diff (`diff -u` before vs. after)

```diff
(empty — diff exit code 0, no output)
```

## Before region contents

```
# My Custom Header

This is a manual addition the user put above the managed section.
It has multiple lines and its own bullets:
- alpha
- beta

```

## After region contents

```
# My Custom Header

This is a manual addition the user put above the managed section.
It has multiple lines and its own bullets:
- alpha
- beta

```

## Verdict

PASS — `shasum` and `diff -u` both confirm the pre-marker region is unchanged.
