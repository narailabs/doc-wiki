# Preamble Preservation Check

Goal: prove that every byte of `target-before.md` appears unchanged at the
start of `target-after.md`. The mermaid agent must only append / replace
content under `## Diagrams`; everything else (frontmatter, preamble,
`<!-- wiki-mermaid: start/end -->` comment markers, and the trailing
paragraph) must be byte-identical.

## 1. `diff -u target-before.md target-after.md`

Only additions — zero deletions, zero modifications — so every original
line is preserved in place:

```
--- target-before.md
+++ target-after.md
@@ -8,3 +8,25 @@
 (empty)
 <!-- wiki-mermaid: end -->
 Trailing paragraph that should also not be touched.
+
+## Diagrams
+
+%% Title: User / Order / Product schema
+```mermaid
+erDiagram
+    User ||--o{ Order : places
+    Order }o--o{ Product : contains
+    User {
+        int id PK
+        string email
+    }
+    Order {
+        int id PK
+        int user_id FK
+        decimal total
+    }
+    Product {
+        int id PK
+        string name
+    }
+```
```

Note: the `@@ -8,3 +8,25 @@` hunk header confirms the context window
covers lines 8-10 of the original (`(empty)` / `wiki-mermaid: end` /
`Trailing paragraph ...`) and shows them as *context* lines (` ` prefix)
in both files — i.e., unchanged. All `+` lines are new content appended
after the original body.

## 2. Byte-for-byte verification via `cmp`

A stronger check than textual diff: extract the first N bytes of
`target-after.md` where N = `wc -c target-before.md`, then run `cmp`
(exits 0 iff the two byte streams are identical):

```
$ head -c $(wc -c < target-before.md) target-after.md > after-prefix.bin
$ cmp target-before.md after-prefix.bin && echo OK
OK
```

Actual tool output during the eval run:

```
BYTE-FOR-BYTE MATCH: before == prefix(after, before_size)
```

## 3. Why this is the correct preservation contract

The agent's `injectMermaid` logic (see
`.claude/agents/wiki-mermaid-agent/scripts/mermaid_gen.ts`) operates
under the `## Diagrams` heading. When that heading is absent it **appends**
a new section at the end of the file — it never rewrites the prefix.
Therefore everything outside the diagrams section (frontmatter, the
preamble paragraph, the `<!-- wiki-mermaid: start/end -->` comment markers
that remain untouched because they contain no `## ` heading, and the
trailing paragraph) is guaranteed preserved, which `cmp` confirms above.
