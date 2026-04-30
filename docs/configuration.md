# Configuration

Two YAML files configure doc-wiki:

- **`wiki.config.yaml`** — lives in the wiki root (created by `/wiki-init`, refined by `/wiki-onboard`). Controls per-wiki behavior: domain, autonomy mode, ORM detection, lint thresholds, custom source agents.
- **`.connectors/config.yaml`** — lives at `~/.connectors/config.yaml` (user-global) and/or `./.connectors/config.yaml` (per-repo overlay). Read by [`narai-primitives`](connectors.md) to know which connectors are enabled and how to authenticate.

This document is the schema reference for both, plus the credential-ref grammar and resolution order.

## Table of contents

- [`wiki.config.yaml`](#wikiconfigyaml)
  - [`wiki` section](#wiki-section)
  - [`ecosystem` section](#ecosystem-section)
  - [`autonomy` section](#autonomy-section)
  - [`sources` section](#sources-section)
  - [`credentials` section](#credentials-section)
  - [`lint` section](#lint-section)
- [`.connectors/config.yaml`](#connectorsconfigyaml)
  - [`connectors` section](#connectors-section)
  - [`environments` overlays](#environments-overlays)
  - [`consumers` overrides](#consumers-overrides)
- [Credential reference grammar](#credential-reference-grammar)
- [Resolution order](#resolution-order)
- [Worked example](#worked-example)

---

## `wiki.config.yaml`

Created by `/wiki-init`, validated by [`parse_config.ts`](../.claude/agents/lib/parse_config.ts), refined by `/wiki-onboard`. The only strictly required field is `wiki.name`; everything else has defaults.

### `wiki` section

```yaml
wiki:
  name: my-project          # REQUIRED — used as wiki title and in frontmatter
  domain: backend-services  # default: "general" — broad topic, used to bias compilation
  max_depth: 3              # default: 3 — recursion depth for /wiki-query graph traversal
  ignore_file: .wiki-ignore # default: ".wiki-ignore" — gitignore-style file inside wiki root
```

| Field | Type | Default | Purpose |
|---|---|---|---|
| `wiki.name` | string | **required** | Wiki name; appears in page frontmatter and `wiki/overview.md` |
| `wiki.domain` | string | `general` | Broad topic; biases page-type selection during compilation |
| `wiki.max_depth` | integer | `3` | Maximum hop depth for `/wiki-query` graph traversal |
| `wiki.ignore_file` | string | `.wiki-ignore` | Path (inside the wiki root) to a gitignore-style file used by ingest passes |

### `ecosystem` section

The `ecosystem` block describes the project's stack and the agents available for source fetching.

```yaml
ecosystem:
  agents:
    source: {}                # populated by /wiki-onboard with one entry per enabled connector
    custom:                   # zero or more custom-connector entries
      - name: stripe
        source_schemes: ["stripe://"]
        source_url_patterns:
          - hostname: api.stripe.com
        invocation_template:
          subagent_type: stripe-agent
          default_model: haiku
          label: "Stripe API"
    model_overrides: {}       # per-agent model overrides (key: agent-id, value: model-name)

  credentials:                # credential provider for wiki-side secrets (NOT connector secrets)
    provider: file            # file | env_var | keychain | cloud_secrets
    config:
      path: ~/.wiki/credentials.json

  database:
    enabled: false
    driver: sqlite            # postgresql | mysql | sqlite | sqlserver | mongodb | dynamodb
    environments: {}          # populated by /wiki-onboard
    policy:
      block_ddl: true
      block_privilege: true
      dml_mode: present_only  # present_only | escalate | deny
      escalate_unbounded_reads: true
    audit:
      enabled: false
      path: ~/.wiki/db_audit.jsonl

  orm:
    enabled: true
    profiles: []              # populated by /wiki-onboard (one of: jpa, sqlalchemy, django, prisma, typeorm, ef, activerecord)
    custom_profiles: []       # paths to additional profile YAML files
    cross_validate_against_db: true

  claude_md:
    enabled: true
    submodule_support: true
    marked_sections: true
    preserve_user_sections: true

  mermaid:
    auto_generate: true
    types: [erDiagram, sequenceDiagram, graph]
    lint_syntax: true
```

The `ecosystem.agents.custom` block is how you register a custom local connector with doc-wiki — see [`connectors.md`](connectors.md#adding-a-custom-local-connector). Each entry maps URL patterns (or scheme prefixes) to the connector's invocation template; `source_registry.ts` uses these to classify sources during `/wiki-ingest`.

The `ecosystem.database` block configures `wiki-orm-agent`'s cross-validation flow against a live DB. The actual connection lives under `connectors.db` in `.connectors/config.yaml`; this block just enables the cross-validation behavior and defines a wiki-side audit log.

### `autonomy` section

```yaml
autonomy:
  mode: balanced              # conservative | balanced | autonomous | auto
  overrides:
    broken_links: auto_fix    # category-specific overrides
    missing_frontmatter: auto_fix
    contradictions: human_review
    stale_content: suggest
```

| Mode | Behavior |
|---|---|
| `conservative` | Suggest only; never auto-apply changes |
| `balanced` | Auto-fix safe categories, escalate others (default) |
| `autonomous` | Auto-fix everything that scores above the quality threshold |
| `auto` | Same as `autonomous`, but skips threshold checks (use only in CI / batch contexts) |

`autonomy.mode` must match exactly one of the four values; `parse_config.ts` validates this at load time. Per-category overrides take precedence over the mode default for that category.

See [`.claude/skills/wiki/references/autonomy.md`](../.claude/skills/wiki/references/autonomy.md) for the full decision flow.

### `sources` section

```yaml
sources:
  providers:
    file: { type: static }
```

Lightweight registry of source providers. Currently only the built-in `file` provider is in use; future versions may register additional static sources here.

### `credentials` section

This top-level block configures **wiki-side** credential resolution (used by `apply_config.ts` to populate the runtime provider registry). It is **separate from** `connectors.<name>.<field>: env:VAR` references in `.connectors/config.yaml`, which are resolved inside the connector subprocess.

```yaml
credentials:
  provider: keychain          # keychain | env_var | file | cloud_secrets
  fallback: [env_var]         # fall back to env vars if primary fails
  prefix: WIKI_               # only used by env_var provider
  # sub_provider: aws         # only when provider == cloud_secrets
```

Most users don't need to think about this block — `keychain` with an env-var fallback is the right default. Override only if you have specific secret-management needs.

### `lint` section

```yaml
lint:
  auto_run_after_ingest: true
  checks:
    structural:
      - broken_links
      - missing_frontmatter
      - orphan_pages
      - index_coverage
      # ... see references/quality.md for the full list
```

For the full set of structural and LLM-driven checks, see [`.claude/skills/wiki/references/quality.md`](../.claude/skills/wiki/references/quality.md).

---

## `.connectors/config.yaml`

Read by [`narai-primitives`](connectors.md)'s config loader. Lives at `~/.connectors/config.yaml` (user-global) with optional per-repo overlay at `./.connectors/config.yaml`. The starter is at [`.connectors/config.example.yaml`](../.connectors/config.example.yaml).

### `connectors` section

Each connector goes in its own block under `connectors`:

```yaml
connectors:
  github:
    enabled: true
    skill: github-agent-connector    # CLI binary name OR absolute path
    token: env:GITHUB_TOKEN          # connector-specific options follow

  jira:
    enabled: true
    skill: jira-agent-connector
    server_url: env:JIRA_SERVER_URL
    email: env:JIRA_EMAIL
    api_token: env:JIRA_API_TOKEN

  confluence:
    enabled: true
    skill: confluence-agent-connector
    server_url: env:CONFLUENCE_SERVER_URL
    email: env:CONFLUENCE_EMAIL
    api_token: env:CONFLUENCE_API_TOKEN

  notion:
    enabled: true
    skill: notion-agent-connector
    token: env:NOTION_TOKEN

  aws:
    enabled: true
    skill: aws-agent-connector
    region: env:AWS_REGION
    # profile: my-profile            # optional override

  gcp:
    enabled: true
    skill: gcp-agent-connector
    project_id: env:GCP_PROJECT_ID

  db:
    enabled: true
    skill: db-agent-connector
    environments:
      dev:
        driver: postgresql           # postgresql | mysql | sqlite | sqlserver | mongodb | dynamodb | oracle
        host: env:DB_DEV_HOST
        database: env:DB_DEV_NAME
        user: env:DB_DEV_USER
        password: env:DB_DEV_PASSWORD
      prod:
        driver: postgresql
        host: env:DB_PROD_HOST
        # ...
    policy:
      dev:
        read: allow
        write: deny
      prod:
        read: escalate
        write: deny
        delete: deny
        admin: deny
        privilege: deny
```

| Field per connector | Type | Purpose |
|---|---|---|
| `enabled` | bool | If `false`, the connector is excluded from `gather()`'s plan |
| `skill` | string | CLI binary name, or absolute/relative path to the connector's `cli.js` |
| (connector-specific) | varies | Each connector has its own option block — see [`connectors.md`](connectors.md) |

Connectors not declared in `connectors` are simply not enabled — there is no implicit "default-on" list.

### `environments` overlays

`gather({ environment: "prod" })` deep-merges `environments.prod` onto the connectors block above. Use this to vary per-env behavior without duplicating the whole file:

```yaml
environments:
  default: dev                # which env to use when not overridden
  dev:
    github:
      model: claude-haiku-4-5 # cheaper model for dev
  prod:
    github:
      model: claude-sonnet-4-6
```

If the caller doesn't pass `environment`, `environments.default` is used. If neither is present, no environment overlay is applied.

### `consumers` overrides

`gather({ consumer: "doc-wiki" })` deep-merges `consumers.doc-wiki` onto the resolved config. Use this for tool-specific preferences:

```yaml
consumers:
  doc-wiki:
    aws:
      enabled: false          # doc-wiki doesn't need AWS even if globally enabled
    gcp:
      enabled: false
    db:
      policy:
        prod:
          read: escalate      # be extra cautious in wiki-driven prod reads
```

doc-wiki always passes `consumer: "doc-wiki"` to `gather()`. Other tools that share the same `~/.connectors/config.yaml` (e.g. an analytics CLI) would pass their own consumer name.

---

## Credential reference grammar

Anywhere a value can be a credential ref in either YAML file, use one of these forms:

| Form | Resolution |
|---|---|
| `env:VAR_NAME` | `process.env.VAR_NAME` |
| `keychain:LABEL` | OS keychain entry — macOS Keychain or libsecret on Linux |
| `file:/abs/path` | File contents (with permission check that the file isn't world-readable) |
| `cloud:aws-secret/<arn>` | AWS Secrets Manager (uses default AWS credential chain to authenticate) |
| `cloud:gcp-secret/<resource>` | GCP Secret Manager (uses Application Default Credentials) |

Mixing forms within one file is fine. Plaintext values are also accepted but **discouraged** — the secret-syntax validator in `narai-primitives/config` warns when it sees a connector option that looks like an inline secret. The intent is that real secrets always go through one of the four resolvers.

For more on resolver behavior, see [`connectors.md`](connectors.md#credential-providers).

---

## Resolution order

When `gather({ consumer, environment })` is called, the final config is computed in this order:

1. **Load** `~/.connectors/config.yaml` (returns `{}` if missing).
2. **Deep-merge** `./.connectors/config.yaml` on top — per-repo overlay wins on conflict.
3. **Apply** `environments.<env>` overlay if `environment` is given (or `environments.<environments.default>` if not).
4. **Apply** `consumers.<consumer>` overlay if `consumer` is given.
5. **Validate** secret refs (no inline plaintext for known sensitive fields).
6. **Return** the `ResolvedConfig` to the planner.

`wiki.config.yaml` is processed independently by `parse_config.ts` — it has no overlay system and no notion of consumers/environments. Each wiki has exactly one `wiki.config.yaml`.

---

## Worked example

A minimal `~/.connectors/config.yaml` for someone who only needs GitHub and Jira:

```yaml
connectors:
  github:
    enabled: true
    skill: github-agent-connector
    token: env:GITHUB_TOKEN

  jira:
    enabled: true
    skill: jira-agent-connector
    server_url: env:JIRA_SERVER_URL
    email: env:JIRA_EMAIL
    api_token: env:JIRA_API_TOKEN

environments:
  default: dev

consumers:
  doc-wiki:
    # No overrides needed — all enabled connectors are wanted for the wiki
```

Set the env vars in your shell rc:

```sh
export GITHUB_TOKEN=ghp_xxx...
export JIRA_SERVER_URL=https://your-org.atlassian.net
export JIRA_EMAIL=you@your-org.com
export JIRA_API_TOKEN=ATATT3xx...
```

A minimal `wiki.config.yaml` (created by `/wiki-init` then refined by `/wiki-onboard`):

```yaml
wiki:
  name: my-backend-wiki
  domain: backend-services

ecosystem:
  agents:
    source:
      github: {}
      jira: {}

autonomy:
  mode: balanced
```

Together, these two files are enough to start running `/wiki-ingest` against GitHub and Jira sources.
