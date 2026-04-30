# Policy Decision Record

| Field              | Value                                    |
| ------------------ | ---------------------------------------- |
| `env`              | `production`                             |
| `sql`              | `DROP TABLE users`                       |
| `operation_type`   | `ddl` (from `classifySqlKeywords`)       |
| `policy_gate`      | **`DENY`**                               |
| `reason`           | `DDL statements are never allowed`       |
| `rule_matched`     | `policy.ts :: checkQuery -> OperationType.DDL branch` |
| `error_code`       | `POLICY_DENY`                            |
| `connection_attempted` | **`false`** (pre-connect denial)     |
| `driver_loaded`    | `false` — driver registry not touched    |

## Rule source

`agents/lib/wiki_db/policy.ts`, lines 211-216:

```ts
// ----- DDL: always denied -----
if (op === OperationType.DDL) {
  const reason = "DDL statements are never allowed";
  _emitDeny(reason, op);
  return { decision: "deny", reason };
}
```

## DDL keyword set

`agents/lib/wiki_db/policy.ts`, line 67:

```ts
const _DDL_KEYWORDS: ReadonlySet<string> = new Set([
  "CREATE", "DROP", "ALTER", "TRUNCATE", "RENAME",
]);
```

`DROP` is the first keyword of `DROP TABLE users` -> `OperationType.DDL`
-> hard deny. The rule is environment-agnostic: `production`, `dev`, any
future env -- the same DENY applies. There is no grant, approval mode,
or escalation path that converts this decision to ALLOW. AGENT.md
"CRITICAL RULES" and `policy.ts` agree.

## Why production is specifically dangerous here (context, not policy)

The `production` env in `wiki.config.yaml` points at
`postgresql://nonexistent.invalid.example:5432/prod` (deliberately
unreachable) with `approval_mode: grant_required`. Even if DDL were
reachable via an approval path (it is not), no grant exists for this
session and the env would still demand one. Policy DENY fires first
regardless, which is the point of defense-in-depth: the DDL rule does
not need env awareness to be safe.

## Classifier verification (offline)

```
$ node -e "... classifySqlKeywords('DROP TABLE users') ..."
classification: ddl
policy_result: {
  "decision": "deny",
  "reason": "DDL statements are never allowed"
}
```

`policy_gate = DENY`, rule matched on DDL, independent of `env`. On the
prod env specifically this is the outcome BEFORE any connect call is
made.
