# Detection Trace — `/wiki-onboard` on the Django + MongoDB fixture

Project root: `/tmp/eval-i3-onboard-django`
Skill: `.claude/skills/wiki/SKILL.md` (`/wiki-onboard`, phases 1-6)

## Phase 1 — Language / framework

SKILL.md ships a marker-file table; scanning the project root produced:

| Marker file observed             | Inference             |
|----------------------------------|-----------------------|
| `requirements.txt`               | language = **python** |
| `manage.py`                      | framework = **django** (Django's standard management stub) |
| `myapp/settings.py` exists and imports `django.db.models` via `myapp/models.py` | reinforces django |

Evidence cited inside `requirements.txt` (verbatim):

```
Django>=4.2
djongo>=1.3.6
pymongo>=3.12.3
```

Written to `wiki.config.yaml`:

```yaml
wiki:
  language: python
  framework: django
```

## Phase 2 — ORM detection (wiki-orm-agent, `django` profile)

Loaded `.claude/agents/lib/wiki_orm/profiles/django.yaml`. The profile
declares three extraction regexes, each applied to `myapp/models.py`:

| Profile pattern (django.yaml)                      | Match in `myapp/models.py`        |
|----------------------------------------------------|-----------------------------------|
| `class\s+(\w+)\s*\(models\.Model\)`  (entity_class)| line 4: `class Article(models.Model):` |
| `db_table\s*=\s*['"]([\w.]+)['"]`   (table_mapping)| line 9: `db_table = "articles"`   |
| `(\w+)\s*=\s*models\.`              (column)       | line 5: `title = models.CharField(max_length=200)` |
|                                                    | line 6: `body = models.TextField()` |

### Extracted entity

| Field        | Value                                      |
|--------------|--------------------------------------------|
| `class_name` | `Article`                                  |
| `table_name` | `articles`  (explicit via `Meta.db_table`, overrides the profile's `snake_case_plural` default) |
| `columns`    | `title` (CharField, max_length=200), `body` (TextField) |
| `relationships` | none                                    |

This is the concrete **Article → articles** mapping the eval requires.

Written to `wiki.config.yaml`:

```yaml
ecosystem:
  orm:
    enabled: true
    profiles:
      - django
    cross_validate_against_db: true
```

## Phase 3 — Database detection (wiki-db-agent)

Parsed `myapp/settings.py` `DATABASES['default']`:

```python
DATABASES = {
    "default": {
        "ENGINE": "djongo",
        "NAME": "mydb",
        "CLIENT": {"host": "mongodb://localhost:27017"},
    }
}
```

`ENGINE == "djongo"` is Django's MongoDB adapter; combined with the `mongodb://`
CLIENT host URI and `pymongo` in requirements, this resolves to:

| Field              | Value                          |
|--------------------|--------------------------------|
| driver             | **mongodb**                    |
| environment        | `dev`                          |
| host / port        | `localhost` / `27017`          |
| database           | `mydb`                         |
| connection_uri     | `mongodb://localhost:27017`    |
| source of truth    | `myapp/settings.py` (DATABASES[default] via djongo) |

### Policy stanza (block_ddl / block_privilege / dml_mode / audit.enabled)

MongoDB has no DDL in the SQL sense, but the policy fields still apply to
`createCollection`, `dropDatabase`, `db.grantRolesToUser`, and write ops.
The onboarded stanza is:

```yaml
ecosystem:
  database:
    enabled: true
    driver: mongodb
    environments:
      dev:
        driver: mongodb
        host: localhost
        port: 27017
        database: mydb
        connection_uri: mongodb://localhost:27017
        approval_mode: auto
        grant_duration_hours: 0
    policy:
      block_ddl: true              # blocks create/drop collection & db
      block_privilege: true        # blocks grantRolesToUser / revokeRole...
      dml_mode: present_only       # insert/update/delete → formatted, never executed
      escalate_unbounded_reads: true
    audit:
      enabled: true                # appends each query to db_audit.jsonl
      path: ~/.wiki/db_audit.jsonl
```

This matches the guard-rail contract in `wiki-db-agent/AGENT.md`
(ALLOW / DENY / ESCALATE / PRESENT_ONLY).

## Phase 4 — External services

Non-interactive eval: no external integrations enabled. Default
`ecosystem.agents.source = {}` preserved.

## Phase 5 — Autonomy

Default `autonomy.mode = balanced` kept.

## Phase 6 — Hooks + multimodal

- `init_wiki.ts` installs Claude Code PreToolUse hooks automatically
  (`.claude/settings.json` was created — see `created_files`).
- Multimodal left at `optional` (graceful-skip when faster-whisper /
  yt-dlp are absent).

## Commands executed

```bash
node .claude/skills/wiki/scripts/init_wiki.js \
    --path /tmp/eval-i3-onboard-django \
    --domain "django-mongodb" --name "myapp Wiki"

# Detected fields patched into wiki.config.yaml:
#   wiki.language: python
#   wiki.framework: django
#   ecosystem.orm.profiles: [django]
#   ecosystem.database: enabled=true, driver=mongodb, environments.dev=...,
#                       policy (DDL/privilege/DML/audit), audit.enabled=true

node .claude/skills/wiki/scripts/parse_config.js \
    --config /tmp/eval-i3-onboard-django/wiki.config.yaml   # validates cleanly

node .claude/skills/wiki/scripts/event_logger.js --op onboard \
    --wiki-root /tmp/eval-i3-onboard-django \
    --details '{"language":"python","framework":"django","orm":"django", \
                "database":"mongodb","entities":[{"class_name":"Article", \
                "table_name":"articles","columns":["title","body"]}], \
                "autonomy":"balanced","multimodal":"optional"}'
```
