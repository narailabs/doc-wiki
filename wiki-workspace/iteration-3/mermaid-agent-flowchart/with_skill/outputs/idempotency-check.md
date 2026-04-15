# idempotency-check

Verifies assertion: running input-1 after input-2 returns the file to the exact
state it was in after the first input-1 run (demonstrating that the generator
is a pure function of the current input, not the history).

## Run sequence

1. `node mermaid_gen.js --input input-1.json --page pipeline.md` → pipeline-after-run1.md
2. `node mermaid_gen.js --input input-2.json --page pipeline.md` → pipeline-after-run2.md
3. `node mermaid_gen.js --input input-1.json --page pipeline.md` → pipeline-after-run3.md

## SHA-256

| Snapshot | sha256 |
|---|---|
| pipeline-after-run1.md | `8a41460e5f1754671019cbb3745ba37887ed2ff28c9f739e4b20d74b102ba2c4` |
| pipeline-after-run2.md | `c47a20b80415b64ec1f2f3f2953dc362c329aa1fd4edefd57e498c7a9cc4f32f` |
| pipeline-after-run3.md | `8a41460e5f1754671019cbb3745ba37887ed2ff28c9f739e4b20d74b102ba2c4` |

`sha256(run3) == sha256(run1)` — byte-identical. `sha256(run2)` differs, as
expected, because input-2 contains a different diagram shape.

## diff run1 vs run3

```
$ diff -u pipeline-after-run1.md pipeline-after-run3.md
# (empty output, exit code 0)
```

Idempotency holds: the file state after `input-1 → input-2 → input-1` is
bit-for-bit identical to the state after the first `input-1` run.
