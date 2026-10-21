# Assertions Evidence

## Assertion 1
**Text:** A new wiki page exists at wiki/auth/authentication-flow.md (or wiki/authentication-flow.md if no topic dir is configured) with frontmatter type='synthesis' OR type='concept', non-empty title, >=4 content-only tags, a sources array referencing the original query's source URLs/files

**Evidence (from promoted-page.md frontmatter):**
```yaml
---
title: Authentication Flow
type: synthesis
tags: [authentication, jwt, sessions, security]
sources:
  - "outputs/queries/2026-04-14-how-does-authentication-work.md"
  - "https://auth0.com/docs/authenticate/login"
  - "wiki/auth.md"
created: "2026-04-14T17:55:00+00:00"
updated: "2026-04-14T17:55:00+00:00"
summary: "End-to-end authentication flow covering JWT issuance, session management, refresh token rotation, and federated OAuth 2.0 login."
---
```

- File exists at: `/tmp/eval-i7-promote-wiki/wiki/auth/authentication-flow.md`
- `type: synthesis` — PASS
- `title: Authentication Flow` — non-empty, PASS
- Tags: `[authentication, jwt, sessions, security]` — 4 tags, PASS (>=4 required)
- Sources array includes the original query archive path — PASS

**CHECK: PASS**

---

## Assertion 2
**Text:** The promoted page's body is derived from (not byte-identical to) the archive — citations to wiki pages in the archive are converted to working relative markdown links, and at least 80% of the archive's prose paragraphs survive into the page

**Evidence (from paragraphs-survival.md):**
- Archive link: `[auth concepts](../../wiki/auth.md)` (relative from `outputs/queries/`)
- Promoted link: `[auth concepts](../auth.md)` (relative from `wiki/auth/`) — correctly resolves to `wiki/auth.md`
- Paragraph survival: 5/5 = 100%
- Pages are not byte-identical: promoted page has different frontmatter (type, sources, summary) and different body link paths

**CHECK: PASS**

---

## Assertion 3
**Text:** The original archive at outputs/queries/2026-04-14-how-does-authentication-work.md still exists and is unmodified (mtime and contents preserved); promote MUST NOT move or delete the archive

**Evidence (from archive-preservation.md):**

| Field | Before | After |
|-------|--------|-------|
| mtime | 2026-04-14T17:54:47 | 2026-04-14T17:54:47 |
| sha256 | 9e0a2373f1abb218fbeea22e9fff6988f335ad5318f09427330312ced4656d39 | 9e0a2373f1abb218fbeea22e9fff6988f335ad5318f09427330312ced4656d39 |

mtime identical, sha256 identical — archive untouched.

**CHECK: PASS**

---

## Assertion 4
**Text:** wiki/index.md (or summaries.md) has a new entry referencing the promoted page's path

**Evidence (from index-after.md):**
```markdown
## Pages

- [Authentication Flow](auth/authentication-flow.md) — End-to-end authentication flow covering JWT issuance, session management, refresh token rotation, and federated OAuth 2.0 login. (promoted 2026-04-14 from outputs/queries/2026-04-14-how-does-authentication-work.md)
```

The path `auth/authentication-flow.md` appears in `wiki/index.md`.

**CHECK: PASS**

---

## Assertion 5
**Text:** graph/edges.jsonl gains at least one edge whose source or target is the new page, with a valid provenance tag (EXTRACTED|INFERRED|AMBIGUOUS) and a typed-edge label (supports|extends|supersedes|contradicts)

**Evidence (from edges-after.jsonl):**
```json
{"from":"wiki/auth/authentication-flow.md","to":"wiki/auth.md","type":"extends","provenance":"INFERRED","created":"2026-04-14T17:55:00+00:00"}
```

- Source is `wiki/auth/authentication-flow.md` (the new page) — PASS
- `type: extends` — valid typed-edge label — PASS
- `provenance: INFERRED` — valid provenance tag — PASS

**CHECK: PASS**

---

## Assertion 6
**Text:** events.jsonl records exactly one entry with op='promote' including source_query (path to the archive), target_page (path to the new wiki page), and an ISO timestamp

**Evidence (from events.jsonl):**
```json
{"ts": "2026-04-15T00:55:19.507000+00:00", "op": "promote", "target_page": "wiki/auth/authentication-flow.md", "source_query": "outputs/queries/2026-04-14-how-does-authentication-work.md", "topic": "authentication-flow"}
```

- Exactly 1 promote event in events.jsonl — PASS (file has 2 lines: 1 init, 1 promote)
- `op: promote` — PASS
- `source_query: outputs/queries/2026-04-14-how-does-authentication-work.md` — PASS
- `target_page: wiki/auth/authentication-flow.md` — PASS
- `ts: 2026-04-15T00:55:19.507000+00:00` — ISO timestamp, PASS

**CHECK: PASS**

---

## Assertion 7
**Text:** Re-running /wiki-promote for the same archive is a no-op or surfaces a 'page already exists' warning — it does not duplicate the page or re-emit the promote event

**Evidence (from idempotency-check.md):**
```
WARNING: Page already exists at wiki/auth/authentication-flow.md — promote is a no-op.
Skipping page creation, edges append, and event logging.
Second-run result: PAGE_EXISTS_NOOP
```

Counts after second run:
- events.jsonl: still 2 lines (no new promote event added)
- edges.jsonl: still 1 line (no duplicate edge)
- promoted page: not overwritten

**CHECK: PASS**
