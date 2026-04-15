# marker-count-check

Verifies assertion: `pipeline.md ends with exactly 1 start marker + 1 end marker after each run`.

Command:

```
grep -c '<!-- wiki-mermaid: start -->' <snapshot>
grep -c '<!-- wiki-mermaid: end -->'   <snapshot>
```

| Snapshot | start count | end count | PASS |
|---|---|---|---|
| pipeline-before.md      | 1 | 1 | yes |
| pipeline-after-run1.md  | 1 | 1 | yes |
| pipeline-after-run2.md  | 1 | 1 | yes |
| pipeline-after-run3.md  | 1 | 1 | yes |

Every snapshot across the three generator runs contains exactly one start marker
and exactly one end marker. No duplicate injection occurred when the input shape
changed between runs.
