# Secret Scan — wiki.config.yaml

## Scan for plaintext credentials

Command run:
```
grep -E "(password|passwd|wikiuser|secret\s*=\s*['\"]|user\s*=\s*['\"])" wiki.config.yaml
```

Result: **NO MATCHES** — no plaintext passwords or usernames found in wiki.config.yaml.

## Credential handling verification

The connection string `postgres://wikiuser@db.local:5432/appdb` was parsed from:
- `src/db.js` (comment: `// DATABASE_URL=postgres://wikiuser@db.local:5432/appdb`)
- `.env.example`

The username `wikiuser` was extracted but NOT written to the config. Instead, the config stores:

```yaml
user_secret: WIKI_DB_DEV_USER
```

This is a secret reference (environment variable / keychain key name), not the plaintext value.

## Fields in wiki.config.yaml database section

```yaml
database:
  enabled: true
  driver: postgresql
  host: db.local
  port: 5432
  database: appdb
  user_secret: WIKI_DB_DEV_USER   ← secret reference only
```

No `password:` field exists. No `user:` field with plaintext value exists.

## Verdict

PASS — wiki.config.yaml contains zero plaintext credentials. Only a secret reference name (`WIKI_DB_DEV_USER`) is stored.
