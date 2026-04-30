# Detection Trace — /wiki-onboard for Django + MongoDB fixture

Project root scanned: `/tmp/eval-onboard-django/`
Run date: 2026-04-14

This trace walks through each detection phase described in `skills/wiki/SKILL.md` and `references/operations.md`, file by file, recording which marker fired and what was concluded.

## Phase 1 — Language / framework detection

Scanned the project root for build-file markers listed in SKILL.md's Phase 1 table.

| File found | Marker table entry | Conclusion |
|---|---|---|
| `/tmp/eval-onboard-django/requirements.txt` | `requirements.txt` -> Python | Language = **Python** |
| `/tmp/eval-onboard-django/manage.py` | Django-specific stub (not in the generic table, but canonical) | Framework = **Django** |

Evidence inspected:

- `requirements.txt` contents (verbatim):
  - `Django>=4.2`
  - `djongo`
  - `pymongo`
  The `Django>=4.2` pin is an unambiguous framework signal; it also pins the
  minimum framework version we record in `stack.framework_version`.
- `manage.py` contains `os.environ.setdefault("DJANGO_SETTINGS_MODULE", "myapp.settings")` and
  `from django.core.management import execute_from_command_line`, the canonical
  Django project stub. Confirms framework = Django (not a generic Python app
  that happens to import django).

No competing markers were present (no `pom.xml`, no `package.json`, no
`go.mod`, etc.), so there was no ambiguity to resolve.

**Result:** stack.language = `python`, stack.framework = `django`, stack.framework_version = `>=4.2`.

## Phase 2 — ORM detection

The SKILL.md ORM table lists Django as: `models.Model` subclasses in
`models.py` / `models/` directories, matching
`agents/lib/wiki_orm/profiles/django.yaml`:

```yaml
detection:
  file_patterns: ["**/models.py", "**/models/**/*.py"]
  markers:
    - pattern: "models.Model"   (entity_class)
    - pattern: "class Meta"     (meta_class)
    - pattern: "db_table"       (table_mapping)
entity_extraction:
  class_pattern: "class\\s+(\\w+)\\s*\\(models\\.Model\\)"
```

File-by-file walk:

- `myapp/models.py` matched `**/models.py` (file pattern).
  - Line 1: `from django.db import models` — import marker for Django ORM.
  - Line 4: `class Article(models.Model):` — matches `entity_class` regex; extracts entity **Article**.
  - Line 10: `class Meta:` — matches `meta_class` marker.
  - Line 11: `db_table = "articles"` — matches `table_mapping`; extracts
    `db_table = articles` (overrides the default snake_case_plural mapping).
  - Field lines (`title = models.CharField(...)`, `body = models.TextField(...)`,
    two `DateTimeField`s) matched the column pattern `(\w+)\s*=\s*models\.`.
- `myapp/settings.py` was inspected for `INSTALLED_APPS` cross-check.
  `"myapp"` appears in `INSTALLED_APPS`, confirming the app whose `models.py`
  we just parsed is actually registered as a Django app.

No other ORM profile markers fired (no `@Entity`, no `declarative_base()`,
no `schema.prisma`, no `DbContext`, no `ApplicationRecord`).

**Result:** orm.profile = `django`; entities detected = 1 (`Article` -> `articles`).

## Phase 3 — Database detection

Per SKILL.md, the database agent looks at:
1. Docker Compose service images
2. `.env` / config-file connection strings
3. ORM config (e.g., Django `DATABASES`, Spring `spring.datasource.url`)

File-by-file walk:

- `docker-compose.yml` — **not present**. No container-service signal.
- `.env` — **not present**.
- `myapp/settings.py` — the `DATABASES` dict (line 32-40) was the primary signal:
  ```python
  DATABASES = {
      "default": {
          "ENGINE": "djongo",
          "NAME": "mydb",
          "CLIENT": {"host": "mongodb://localhost:27017"},
      }
  }
  ```
  Two independent indicators point at MongoDB:
  1. **ENGINE = `djongo`** — djongo is explicitly the Django+MongoDB connector
     (reinforced by `djongo` in `requirements.txt`).
  2. **host = `mongodb://localhost:27017`** — `mongodb://` URI scheme and port
     27017 are MongoDB's canonical defaults.
- `requirements.txt` cross-check — `pymongo` is present as a peer dependency,
  consistent with MongoDB access from Python.

No credentials were embedded (host-only URI); `credentials.redacted` is
trivially true.

**Result:** ecosystem.database.driver = `mongodb`; connector = `djongo`;
environments.default = `{engine: djongo, name: mydb, host: mongodb://localhost:27017}`.
Guard-rail policy left at scaffold defaults (`block_ddl`, `block_privilege`,
`dml_mode: present_only`, `escalate_unbounded_reads`). Audit enabled because
the database is now actively configured.

## Phase 4 — External services Q&A

The task is a non-interactive eval (no user present to answer). Applied the
documented conservative default: leave every external source disabled and
leave `ecosystem.agents.source = {}`. No Jira, Confluence, GCP, AWS, Notion,
or GitHub agents were enabled. The user can turn any of them on later by
re-running `/wiki-onboard`.

## Phase 5 — Autonomy mode

Default per SKILL.md: `balanced` (auto-fix safe changes, ask for structural).
Kept the scaffold default, matching the recommendation.

## Phase 6 — Hooks + scaffold + multimodal

- **Scaffold:** `init_wiki.js` created the wiki at `/tmp/eval-onboard-django/`
  in a single idempotent run; creates `wiki/`, `raw/`, `graph/`, `audit/`,
  `log/`, `outputs/`, `.wiki-cache/`, plus seed pages
  (`wiki/index.md`, `wiki/summaries.md`, `wiki/overview.md`), `.wiki-ignore`,
  and empty `log/events.jsonl` + `graph/edges.jsonl`.
- **Claude Code hooks:** `init_wiki.ts` automatically installed Claude Code
  PreToolUse hooks into `.claude/settings.json` (one of the
  `created_files`). Other platforms (Codex, Cursor, Aider) left on-demand.
- **Multimodal:** kept scaffold default `optional` — multimodal ingests will
  warn-and-skip if `faster-whisper` / `yt-dlp` aren't on PATH. Eval is
  non-interactive; printing install commands would be noise.

## Summary of detected stack

| Field | Value | Primary evidence |
|---|---|---|
| Language | Python | `requirements.txt` present |
| Framework | Django >= 4.2 | `Django>=4.2` in `requirements.txt`; `manage.py` stub |
| ORM profile | django | `myapp/models.py` -> `class Article(models.Model)` |
| Database | MongoDB | `settings.py` DATABASES ENGINE=djongo, host=`mongodb://localhost:27017` |
| DB connector | djongo | `requirements.txt` + `settings.py` ENGINE field |
| External sources | none | No user Q&A in non-interactive eval |
| Autonomy | balanced | SKILL.md default |
| Multimodal | optional | SKILL.md default |
