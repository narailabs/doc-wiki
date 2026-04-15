---
title: Credentials Safety Check — wiki.config.yaml
eval: wiki-onboard-spring-boot (iteration-3)
date: 2026-04-14
verdict: PASS (no plaintext credentials)
---

# Credentials safety check

Required assertion: *"Credentials are referenced via secret names (e.g.,
`user_secret: WIKI_DB_DEV_USER`) — plaintext passwords anywhere in
`wiki.config.yaml` is a failure."*

## Method

Ran three greps against
`/Users/narayan/src/doc-wiki/wiki-workspace/iteration-3/wiki-onboard-spring-boot/with_skill/outputs/wiki.config.yaml`:

1. A broad plaintext-credential pattern
   `(?i)(password|passwd|secret|token)\s*[:=]\s*[A-Za-z0-9!@#$%^&*_\-]{4,}`
   (looking for any credential keyword followed by a 4+ char literal value).
2. A case-insensitive `password` scan.
3. A case-insensitive `secret` scan.

Every match is manually classified below as SECRET-REFERENCE, ENV-PLACEHOLDER,
or PLAINTEXT.

## Grep results (with classification)

### 1. Broad plaintext pattern

```
27:        user_secret: WIKI_DB_DEV_USER
28:        password_secret: WIKI_DB_DEV_PASSWORD
```

| Line | Content | Classification | Reason |
|------|---------|----------------|--------|
| 27 | `user_secret: WIKI_DB_DEV_USER` | SECRET-REFERENCE | Uppercase, `WIKI_`-prefixed key name stored in keychain per top-level `credentials.prefix: WIKI_`. Value is a **lookup name**, not a credential. |
| 28 | `password_secret: WIKI_DB_DEV_PASSWORD` | SECRET-REFERENCE | Same — a secret-store key name, not a password value. |

### 2. `password` (case-insensitive)

```
28:        password_secret: WIKI_DB_DEV_PASSWORD
32:        password_ref: ${DB_PASSWORD}
```

| Line | Content | Classification | Reason |
|------|---------|----------------|--------|
| 28 | `password_secret: WIKI_DB_DEV_PASSWORD` | SECRET-REFERENCE | See above. |
| 32 | `password_ref: ${DB_PASSWORD}` | ENV-PLACEHOLDER | Verbatim copy of the `${DB_PASSWORD}` token from `application.properties` — the value is resolved at runtime by Spring Boot from the environment. It is a reference string, not the password. |

### 3. `secret` (case-insensitive)

```
27:        user_secret: WIKI_DB_DEV_USER
28:        password_secret: WIKI_DB_DEV_PASSWORD
```

Both lines are SECRET-REFERENCE (already classified above).

## Secret-name references (the only credential-carrying fields in the config)

```yaml
ecosystem:
  database:
    environments:
      dev:
        user_secret: WIKI_DB_DEV_USER
        password_secret: WIKI_DB_DEV_PASSWORD
        username_ref: ${DB_USER}
        password_ref: ${DB_PASSWORD}
```

- `user_secret` / `password_secret` — **keychain/secret-store names**, resolved
  at query time by the shared wiki-db library using `credentials.prefix: WIKI_`
  and the fallback order `[keychain, env_var]`.
- `username_ref` / `password_ref` — preserved **source tokens** from
  `application.properties` so the trace can reproduce the detection, but they
  are not resolved here either (they remain literal `${DB_USER}` /
  `${DB_PASSWORD}` strings).

## Verdict

**PASS.** Zero plaintext credentials in `wiki.config.yaml`. Every `password` /
`secret` match is either an uppercase secret-store key name
(`WIKI_DB_DEV_*`) or a shell-style environment placeholder (`${DB_*}`). No
literal username or password values appear anywhere in the file.
