# Wiki-Managed Marker Count Check

**Assertion:** Every generated CLAUDE.md contains exactly one
`<!-- wiki-managed: start -->` and one `<!-- wiki-managed: end -->` marker
(grep -c returns 1 for each on every file).

## Command

```bash
for f in <file>; do
  s=$(grep -c '<!-- wiki-managed: start -->' "$f")
  e=$(grep -c '<!-- wiki-managed: end -->' "$f")
  echo "$f start=$s end=$e"
done
```

## Results

| File | start_count | end_count | Pass |
|---|---|---|---|
| `/tmp/eval-i3-cmd-gen/CLAUDE.md` | 1 | 1 | yes |
| `/tmp/eval-i3-cmd-gen/services/api/CLAUDE.md` | 1 | 1 | yes |
| `/tmp/eval-i3-cmd-gen/services/worker/CLAUDE.md` | 1 | 1 | yes |
| `/tmp/eval-i3-cmd-gen/services/gateway/CLAUDE.md` | 1 | 1 | yes |

## Verdict

PASS — `start_count == 1 && end_count == 1` for all 4 files (root + 3 submodules).
