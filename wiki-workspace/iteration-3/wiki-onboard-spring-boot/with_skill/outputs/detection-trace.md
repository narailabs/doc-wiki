---
title: Spring Boot / JPA / PostgreSQL Detection Trace
eval: wiki-onboard-spring-boot (iteration-3)
fixture_root: /tmp/eval-i3-onboard-sb
date: 2026-04-14
---

# Detection trace — `/wiki-onboard` against Spring Boot + PostgreSQL fixture

This trace documents how each detected value in `wiki.config.yaml` was derived,
citing the exact fixture files and line numbers consulted.

## Phase 1 — Language & framework (from `pom.xml`)

**Marker file present:** `/tmp/eval-i3-onboard-sb/pom.xml` → per SKILL.md
Phase-1 table, this pins `language=java`, `build_tool=maven`.

**Framework + version evidence — `pom.xml` lines 8-13:**

```xml
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.0</version>
        <relativePath/>
    </parent>
```

- `<groupId>org.springframework.boot</groupId>` on line 9 identifies the framework
  family as Spring Boot.
- `<artifactId>spring-boot-starter-parent</artifactId>` on line 10 identifies the
  canonical parent POM used for Spring Boot applications.
- `<version>3.2.0</version>` on **line 11** pins the Spring Boot version.

Additional corroboration — `pom.xml` lines 26-29 include
`spring-boot-starter-data-jpa`, which further confirms this is a JPA-backed
Spring Boot project.

**Written to `wiki.config.yaml`:**
```yaml
ecosystem:
  language: java
  build_tool: maven
  framework: spring-boot
  framework_version: 3.2.0
```

## Phase 2 — ORM profile (from `.java` scan)

Per SKILL.md, JPA detection scans `.java` / `.kt` files for `@Entity`, `@Table`,
`@Column` annotations and a `javax.persistence.*` (or `jakarta.persistence.*`)
import.

**Files scanned under `/tmp/eval-i3-onboard-sb/src/main/java/com/example/myapp/`:**

| File | `@Entity` class | `@Table(name=...)` | JPA import |
|------|----------------|--------------------|------------|
| `User.java` | `User` (line 8) | `users` schema `public` (line 7) | `javax.persistence.*` (line 3) |
| `Order.java` | `Order` (line 7) | `orders` (line 6) | `javax.persistence.*` (line 3) |
| `UserRepository.java` | *(not an entity — extends `JpaRepository<User, Long>`)* | — | `org.springframework.data.jpa.repository.JpaRepository` (line 4) |

**Concrete `@Entity` class evidence:**

From `User.java`:
```java
@Entity
@Table(name = "users", schema = "public")
public class User {
```

From `Order.java`:
```java
@Entity
@Table(name = "orders")
public class Order {
```

**Entities detected:** `User`, `Order` (2).
**Repository confirming Spring Data JPA usage:** `UserRepository` extends
`JpaRepository<User, Long>`.

**Written to `wiki.config.yaml`:**
```yaml
ecosystem:
  orm:
    enabled: true
    profiles:
    - jpa
    detected_entities:
    - User
    - Order
```

## Phase 3 — Database (from `application.properties`)

Per SKILL.md, Phase-3 reads connection strings from `application.properties` and
parses `spring.datasource.url`.

**Source file:** `/tmp/eval-i3-onboard-sb/src/main/resources/application.properties`

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/mydb
spring.datasource.username=${DB_USER}
spring.datasource.password=${DB_PASSWORD}
spring.datasource.driver-class-name=org.postgresql.Driver
```

**JDBC URL parse:**

| Component | Value | Origin |
|-----------|-------|--------|
| Scheme | `jdbc:postgresql` | `jdbc:<driver>` prefix → `driver=postgresql` |
| Host | `localhost` | after `//`, before `:` |
| Port | `5432` | between `:` and `/` |
| Database | `mydb` | after the final `/` |
| Driver class | `org.postgresql.Driver` | `spring.datasource.driver-class-name` |

Cross-check: `pom.xml` line 35 declares `<groupId>org.postgresql</groupId>` /
`<artifactId>postgresql</artifactId>` with `<scope>runtime</scope>` — confirms
the PostgreSQL JDBC driver is on the classpath.

**Credential references preserved (not resolved to plaintext):**

- `spring.datasource.username=${DB_USER}` → `username_ref: ${DB_USER}` (treated
  as an environment-variable placeholder; NOT copied to `user_secret`)
- `spring.datasource.password=${DB_PASSWORD}` → `password_ref: ${DB_PASSWORD}`
  (same handling)

Per the Security Baseline, `user_secret` / `password_secret` in the config hold
**secret-store names only**, never the values themselves. They map to the
`WIKI_` prefix via the keychain/env fallback declared in top-level
`credentials:`.

**Written to `wiki.config.yaml`:**
```yaml
ecosystem:
  database:
    enabled: true
    driver: postgresql
    environments:
      dev:
        host: localhost
        port: 5432
        database: mydb
        user_secret: WIKI_DB_DEV_USER
        password_secret: WIKI_DB_DEV_PASSWORD
        source: src/main/resources/application.properties
        jdbc_url: jdbc:postgresql://localhost:5432/mydb
        username_ref: ${DB_USER}
        password_ref: ${DB_PASSWORD}
    policy:
      block_ddl: true
      block_privilege: true
      dml_mode: present_only
      escalate_unbounded_reads: true
    audit:
      enabled: true
      path: ~/.wiki/db_audit.jsonl
```

## Phase 4-6 — Not applicable for this eval

External source Q&A (Jira, Confluence, GCP, AWS, Notion, GitHub) produced no
enabled source agents for this fixture. Autonomy mode defaulted to `balanced`.
Multimodal stayed at `optional` (no audio/video ingest expected).

## Summary (assertion-aligned)

| Assertion | Result | Evidence |
|-----------|--------|----------|
| framework = `spring-boot` AND version = `3.2.0` | **PASS** | `pom.xml` line 11 |
| ORM profile includes `jpa` AND ≥1 `@Entity` named | **PASS** | `User` (User.java:8), `Order` (Order.java:7) |
| driver=`postgresql`, host+port+db match URL | **PASS** | `localhost:5432/mydb` from application.properties line 1 |
| Credentials via secret names — no plaintext | **PASS** | `WIKI_DB_DEV_USER` / `WIKI_DB_DEV_PASSWORD`; source refs `${DB_USER}` / `${DB_PASSWORD}` |
| Policy stanza populated (DDL/privilege/dml/audit) | **PASS** | `block_ddl: true`, `block_privilege: true`, `dml_mode: present_only`, `audit.enabled: true` |
| Scaffold exists at wiki root | **PASS** | `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/` all created |
