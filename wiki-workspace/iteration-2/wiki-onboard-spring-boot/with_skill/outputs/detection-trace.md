# /wiki-onboard Detection Trace

Target project: `/tmp/eval-onboard-sb`
Skill: `/Users/narayan/src/doc-wiki/.claude/skills/wiki/SKILL.md`
Reference: `references/operations.md` (sections: Codebase Detection, ORM Detection, Database Detection)

## Phase 1 - Language / framework detection

Files inspected at project root:

| Path | Present | Marker table in SKILL.md | Conclusion |
|---|---|---|---|
| `/tmp/eval-onboard-sb/pom.xml` | yes | "pom.xml, build.gradle -> Java (Maven / Gradle)" | Java, Maven build tool |
| `/tmp/eval-onboard-sb/build.gradle` | no | - | - |
| `/tmp/eval-onboard-sb/package.json` | no | - | - |
| `/tmp/eval-onboard-sb/requirements.txt` | no | - | - |
| `/tmp/eval-onboard-sb/go.mod` | no | - | - |
| `/tmp/eval-onboard-sb/Cargo.toml` | no | - | - |
| `/tmp/eval-onboard-sb/docker-compose.yml` | no | - | - |

Content scan of `pom.xml` (regex `spring-boot|spring-boot-starter-data-jpa|postgresql`):

- `<artifactId>spring-boot-starter-parent</artifactId>` (line 12) -> framework: **Spring Boot**
- `<artifactId>spring-boot-starter-web</artifactId>` (line 23) -> web stack
- `<artifactId>spring-boot-starter-data-jpa</artifactId>` (line 27) -> ORM: **JPA / Spring Data JPA**
- `<groupId>org.postgresql</groupId>` / `<artifactId>postgresql</artifactId>` (lines 30-31) -> DB driver: **PostgreSQL**

Conclusion: **Java 17 / Maven / Spring Boot 3.2** (verified via `<java.version>17</java.version>` + `spring-boot-starter-parent 3.2.0`).

## Phase 2 - ORM detection

Per `operations.md` JPA detection markers: `@Entity`, `@Table`, `extends JpaRepository`.

Grep over `/tmp/eval-onboard-sb/src` for `@Entity|@Table|@Column|extends JpaRepository`:

| File | Line | Match | Maps to JPA profile marker |
|---|---|---|---|
| `src/main/java/com/example/myapp/User.java` | 6 | `@Entity` | `entity_class` |
| `src/main/java/com/example/myapp/User.java` | 7 | `@Table(name = "users", schema = "public")` | `table_mapping` -> table=`users`, schema=`public` |
| `src/main/java/com/example/myapp/User.java` | 14 | `@Column(name = "username", ...)` | column: `username` |
| `src/main/java/com/example/myapp/User.java` | 17 | `@Column(name = "email")` | column: `email` |
| `src/main/java/com/example/myapp/Order.java` | 5 | `@Entity` | `entity_class` |
| `src/main/java/com/example/myapp/Order.java` | 6 | `@Table(name = "orders")` | `table_mapping` -> table=`orders` |
| `src/main/java/com/example/myapp/Order.java` | 13 | `@Column(name = "total_amount")` | column: `total_amount` |
| `src/main/java/com/example/myapp/UserRepository.java` | 6 | `extends JpaRepository<User, Long>` | `repository` |

Additional relationship markers observed (JPA profile `relationship_detection`):

- `User.java:20` `@OneToMany(mappedBy = "user", cascade = CascadeType.ALL)` -> `one_to_many` (User -> Order)
- `User.java:23` `@ManyToMany` with `@JoinTable(name = "user_roles")` -> `many_to_many` (User <-> Role)
- `Order.java:16` `@ManyToOne` with `@JoinColumn(name = "user_id")` -> `many_to_one` (Order -> User)

Entities detected: **2** (`User`, `Order`). Repositories: **1** (`UserRepository`).
ORM profile selected: **`jpa`** (matches `/Users/narayan/src/doc-wiki/.claude/agents/lib/wiki_orm/profiles/jpa.yaml`).

## Phase 3 - Database detection

Per `operations.md`: check connection strings, ORM config, Docker Compose services.

Files scanned:

| File | Regex | Finding |
|---|---|---|
| `src/main/resources/application.properties:1` | `spring\.datasource\.url` | `jdbc:postgresql://localhost:5432/mydb` -> engine=postgres, host=localhost, port=5432, db=mydb |
| `src/main/resources/application.properties:4` | `driver-class-name` | `org.postgresql.Driver` -> confirms PostgreSQL JDBC driver |
| `src/main/resources/application.properties:8` | `hibernate.dialect` | `org.hibernate.dialect.PostgreSQLDialect` -> confirms PostgreSQL |
| `pom.xml:30-31` | dependency | `org.postgresql:postgresql` runtime dep -> confirms |
| `docker-compose.yml` | presence | not present (no container-side corroboration) |

Conclusion: **PostgreSQL** on `localhost:5432`, database `mydb`. Environment keyed as `dev` in config; credentials sourced from `WIKI_DB_DEV_USER` / `WIKI_DB_DEV_PASSWORD` secrets (no plaintext in config).

## Phase 4 - External services Q&A

Non-interactive eval: no platform markers present in project (no `.github/`, no Jira/Confluence URLs in config, no `aws`/`gcp` SDK deps in `pom.xml`). Source agents therefore left **disabled** (`ecosystem.agents.source: {}`).

## Phase 5 - Autonomy mode

Default `balanced` retained (recommended for interactive use per `operations.md` Q&A flow step 5).

## Phase 6 - Hooks + scaffold

- `installClaudeCodeHooks()` (called inside `init_wiki.js`) wrote `.claude/settings.json` -> reported in `created_files`.
- `wiki.config.yaml` generated with defaults then edited in-place to reflect detected stack.
- Scaffold created via `node init_wiki.js --path /tmp/eval-onboard-sb --domain spring-boot-backend --name myapp`.

### Phase 6b - Multimodal

No audio/video inputs anticipated; retained default `multimodal.enabled: optional` (graceful skip if `faster-whisper` / `yt-dlp` are absent).

## Scripts invoked

| Command | Purpose | Exit |
|---|---|---|
| `node init_wiki.js --path /tmp/eval-onboard-sb --domain spring-boot-backend --name myapp` | Scaffold dirs + default config | ok |
| `node parse_config.js --config /tmp/eval-onboard-sb/wiki.config.yaml` | Validate edited config | 0 (JSON emitted) |
| `node event_logger.js --op onboard --wiki-root /tmp/eval-onboard-sb --details '{...}'` | Log onboard event to `log/events.jsonl` | ok |

## Integrations configured

- `wiki-db-agent`: enabled, driver=postgresql, dev env wired
- `wiki-orm-agent`: enabled, profile=jpa (cross-validate against DB: on)
- `wiki-claude-md-agent`: enabled (default)
- `wiki-mermaid-agent`: enabled (default, types: erDiagram, sequenceDiagram, graph)
- Source agents (jira/confluence/github/notion/gcp/aws): all off (no markers detected, no user confirmation in eval)
