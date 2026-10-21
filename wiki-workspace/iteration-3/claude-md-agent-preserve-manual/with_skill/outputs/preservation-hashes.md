# 3-region SHA-256 Preservation Check

Regions are split around the `<!-- wiki-managed: start -->` and
`<!-- wiki-managed: end -->` markers (markers themselves belong to the
managed region). Sizes and hashes are computed against raw bytes of
`/tmp/eval-i3-cmd-preserve/CLAUDE.md`.

| Region  | Bytes before | SHA-256 before                                                     | Bytes after | SHA-256 after                                                      | Expected                | Result |
|---------|--------------|--------------------------------------------------------------------|-------------|--------------------------------------------------------------------|-------------------------|--------|
| pre     | 52           | `b8dffa0c78a6d083e2189c920731db64b447f9a1a71931f0504bcb8f560b7ce7` | 52          | `b8dffa0c78a6d083e2189c920731db64b447f9a1a71931f0504bcb8f560b7ce7` | before == after         | PASS   |
| managed | 79           | `6662eeddc77b517de904883a0d458bd348d0b3dec7b02303ff2e81963d480cfe` | 366         | `8f7a965ec8bba334ac97b041e75b0b84369c018960d6a4012e6ff3c28f2a0ca5` | before != after         | PASS   |
| post    | 47           | `2d83eb553a0c387f642c324f4f290f3aaae51c0335b699892441f933c1461556` | 47          | `2d83eb553a0c387f642c324f4f290f3aaae51c0335b699892441f933c1461556` | before == after         | PASS   |

## Raw pre-region bytes (before)
```
# My Custom Header\n\nUser's manual intro paragraph.\n\n
```

## Raw post-region bytes (before)
```
\n\n## Manual footer\n\nUser's manual footer note.\n
```

Both pre and post regions match byte-for-byte across the regeneration,
proving the user's manual header, intro paragraph, and footer are
untouched. The managed region hash changed (79 -> 366 bytes), proving the
agent actually regenerated the section rather than no-oping.
