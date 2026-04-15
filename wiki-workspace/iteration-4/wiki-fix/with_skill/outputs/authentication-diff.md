# authentication.md — unified diff (pre vs post)

Exactly three content substitutions (summary + 2 body paragraphs) plus the
frontmatter `updated` bump. No other lines changed.

```diff
--- wiki-before/authentication.md	2026-04-14
+++ wiki-after/authentication.md	2026-04-14
@@ -4,8 +4,8 @@
 tags: [auth, jwt, security]
 sources: [internal-docs]
 created: 2026-04-10
-updated: 2026-04-10
-summary: Service uses HS256 signing for JWT access tokens issued by the auth gateway.
+updated: 2026-04-14
+summary: Service uses RS256 signing for JWT access tokens issued by the auth gateway.
 quality: 0.85
 ---
 
@@ -14,12 +14,12 @@
 ## Overview
 
 The authentication service issues JWT access tokens to API clients. Each token is
-signed with HS256 and has a 60-minute TTL. The signing secret is rotated weekly
+signed with RS256 and has a 60-minute TTL. The signing secret is rotated weekly
 and delivered to service pods through the platform secrets manager.
 
 ## Token verification
 
-Downstream services verify tokens using the shared HS256 secret. Because the
+Downstream services verify tokens using the shared RS256 secret. Because the
 signing and verification keys are the same, all services that accept these
 tokens must have read access to the secret. The public verifier endpoint exposes
 a `/jwks` stub for compatibility but does not currently publish asymmetric keys.
```

## HS256/RS256 token counts

| metric                            | before | after |
|-----------------------------------|--------|-------|
| occurrences of `HS256` in page    | 3      | 0     |
| occurrences of `RS256` in page    | 0      | 3     |

`grep -c` confirms: post-fix page has 0 hits for HS256 and 3 hits for RS256.
