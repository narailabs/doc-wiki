# Marker-Count and Whitespace-Drift Check

Assertion: after regeneration the file must contain exactly one
`<!-- wiki-managed: start -->` marker and exactly one
`<!-- wiki-managed: end -->` marker, and those marker lines must not
have accumulated any leading/trailing whitespace.

## grep -c counts (against `/tmp/eval-i3-cmd-preserve/CLAUDE.md`)

```
$ grep -c '<!-- wiki-managed: start -->' CLAUDE.md
1
$ grep -c '<!-- wiki-managed: end -->' CLAUDE.md
1
```

Counts are exactly 1 for each marker -> no duplication.

## Exact marker-line bytes

```
$ grep -n '<!-- wiki-managed:' CLAUDE.md | od -c
0000000    5   :   <   !   -   -       w   i   k   i   -   m   a   n   a
0000020    g   e   d   :       s   t   a   r   t       -   -   >  \n   2
0000040    3   :   <   !   -   -       w   i   k   i   -   m   a   n   a
0000060    g   e   d   :       e   n   d       -   -   >  \n
```

Line 5 is exactly `<!-- wiki-managed: start -->\n`. Line 23 is exactly
`<!-- wiki-managed: end -->\n`. No leading spaces, no trailing spaces,
no tabs -- the bytes of each marker line are identical to the constant
literals `MARKER_START` / `MARKER_END` in `claude_md_gen.ts`.

## Programmatic verification

```
START_LINE_EQUALS_MARKER_EXACTLY = True
END_LINE_EQUALS_MARKER_EXACTLY   = True
START_COUNT = 1
END_COUNT   = 1
```

Result: PASS.
