# Frontmatter Diff: Before vs After Refresh

## Manual field `reviewer: alice` — PRESERVED

### Before (page-before.md)
```yaml
reviewer: alice
```

### After (page-after.md)
```yaml
reviewer: alice
```
Status: **PRESERVED** — identical value, key retained in same relative position.

---

## `created` — UNCHANGED

### Before
```yaml
created: "2026-04-10T08:00:00+00:00"
```

### After
```yaml
created: "2026-04-10T08:00:00+00:00"
```
Status: **UNCHANGED** — original creation timestamp retained.

---

## `updated` — REFRESHED

### Before
```yaml
updated: "2026-04-10T08:00:00+00:00"
```

### After
```yaml
updated: "2026-04-15T00:56:30+00:00"
```
Status: **UPDATED** — reflects refresh timestamp.

---

## `summary` — REFRESHED

### Before
```yaml
summary: Original microservices architecture using API gateway, service mesh, Kafka event bus, multi-store data layer, and Kubernetes deployment with full observability stack.
```

### After
```yaml
summary: Redesigned platform architecture centered on the unified gateway ingress control plane, upgraded service mesh with eBPF telemetry, consolidated data layer, Confluent Cloud Kafka migration, and unified OpenTelemetry observability stack with zero-trust networking.
```
Status: **UPDATED** — reflects new content from modified source.

---

## `tags` — REFRESHED

### Before
```yaml
tags:
  - architecture
  - microservices
  - kubernetes
  - api-gateway
  - messaging
  - observability
  - security
```

### After
```yaml
tags:
  - architecture
  - microservices
  - kubernetes
  - unified-gateway-ingress
  - control-plane
  - observability
  - zero-trust
  - ebpf
```
Status: **UPDATED** — tags reflect new concepts introduced in v2 source.

---

## `sources` — PRESERVED (same source file)

Both before and after:
```yaml
sources:
  - raw/architecture.md
```
Status: **UNCHANGED** — source file reference is the same.
