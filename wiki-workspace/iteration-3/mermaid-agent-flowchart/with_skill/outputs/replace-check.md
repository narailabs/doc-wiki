# replace-check

Verifies two assertions:

1. Re-running with a DIFFERENT input REPLACES (not appends) the block between
   the markers.
2. Content OUTSIDE the markers is byte-identical across runs.

## Between-markers diff (run1 vs run2)

```
--- pipeline-after-run1.md
+++ pipeline-after-run2.md
@@ -12,10 +12,12 @@
 ```mermaid
 flowchart TD
     checkout --> build
-    build --> docker
+    build --> test
+    test --> docker
     docker --> push
     push --> deploy
     deploy --> smoke
+    smoke --> notify
 ```
 <!-- wiki-mermaid: end -->
```

Every changed line sits strictly between the `<!-- wiki-mermaid: start -->` and
`<!-- wiki-mermaid: end -->` markers. The new input-2 added a `test` node and a
trailing `notify` node; the generator rewrote the mermaid code in place instead
of appending a second block.

## Outside-markers byte equality

SHA-256 of the slice consisting of everything up to and including the start
marker plus everything from the end marker onward (i.e. frontmatter, heading,
prose, and `## Operational notes` section):

| Snapshot | outside-markers sha256 (first 16) | bytes |
|---|---|---|
| pipeline-before.md      | d01a9c64c13159eb | 237 |
| pipeline-after-run1.md  | d01a9c64c13159eb | 237 |
| pipeline-after-run2.md  | d01a9c64c13159eb | 237 |
| pipeline-after-run3.md  | d01a9c64c13159eb | 237 |

All four snapshots share the same outside-markers hash — the frontmatter,
`# Deploy Pipeline` heading, intro prose, and the trailing
`## Operational notes` section are preserved byte-for-byte across every run.
