# Preamble (outside-markers) check

Verifies that `mermaid_gen.js` only modifies bytes **between** the
`wiki-mermaid` markers and never touches the surrounding content (frontmatter,
heading, preamble, trailing paragraph, or the marker comments themselves).

## Method

For both `request-flow-before.md` and `request-flow-after.md`, compute the
concatenation of:

1. All bytes up to and including `<!-- wiki-mermaid: start -->`
2. All bytes from `<!-- wiki-mermaid: end -->` through EOF

This is the "outside-markers" region. If the agent is well-behaved this
region must be byte-identical before and after injection.

## Sha256 results

| Artifact                                      | Outside-markers length | Sha256 |
|-----------------------------------------------|------------------------|--------|
| `request-flow-before.md` (pre-injection)      | 455 bytes              | `893a58081403d8e1a12a98847c6b8e79e8f3862496dcd49c34c73e4c56083f32` |
| `request-flow-after.md`  (post-injection)     | 455 bytes              | `893a58081403d8e1a12a98847c6b8e79e8f3862496dcd49c34c73e4c56083f32` |

**Byte-identical outside markers: yes.**

For reference, the full-file hashes differ (because the between-markers
region was intentionally replaced):

| Artifact                   | Full-file sha256 |
|----------------------------|------------------|
| `request-flow-before.md`   | `f38a70fa9a738043a27ffa7b0511fe3768a74628c439210a78c44a0d7addc08c` |
| `request-flow-after.md`    | `8185f6f51702de452bafad473c307c7da4b8c785a3fb9269bbc51dd74dcfbd5c` |

## Unified diff (full file)

```diff
--- request-flow-before.md
+++ request-flow-after.md
@@ -11,7 +11,22 @@
 by the `wiki-mermaid-agent` whenever the upstream service topology changes.
 
 <!-- wiki-mermaid: start -->
-_Stale placeholder — this content will be replaced by mermaid_gen.js on next run._
+%% Title: Authenticated API request flow
+```mermaid
+sequenceDiagram
+    participant Client
+    participant Gateway as API Gateway
+    participant Auth as Auth Service
+    participant DB as Database
+    Client->>Gateway: POST /orders
+    Gateway->>Auth: verify(token)
+    Auth->>DB: SELECT user WHERE session_id=?
+    DB-->>Auth: user row
+    Auth-->>Gateway: user_id
+    Gateway->>DB: INSERT INTO orders ...
+    DB-->>Gateway: order_id
+    Gateway-->>Client: 201 Created
+```
 <!-- wiki-mermaid: end -->
 
 See the related pages on auth tokens and order persistence for more context.
```

Every removed (`-`) and added (`+`) line sits strictly **between** the
`<!-- wiki-mermaid: start -->` and `<!-- wiki-mermaid: end -->` marker lines.
The marker lines themselves, the frontmatter, the `# Request flow` heading,
the preamble paragraph, and the trailing paragraph are untouched.

## Conclusion

`mermaid_gen.js` preserved the preamble byte-for-byte. Outside-markers
sha256 matches exactly (`893a5808…f32`), and the full-file diff is confined
to the region between the markers.
