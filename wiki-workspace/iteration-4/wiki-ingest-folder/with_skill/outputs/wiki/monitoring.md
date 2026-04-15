---
title: "Monitoring and Observability"
page_type: reference
sources:
  - /tmp/eval-i4-ingest-folder/docs/monitoring.md
tags: ["prometheus", "opentelemetry", "slo-alerting", "pagerduty", "postmortems"]
content_hash: "74848ca820bddd87684d99226a275d97cc40346029d456c1a83a40633c76a8c3"
ingested_at: "2026-04-14T20:07:09.141Z"
---
# Monitoring and Observability

# Monitoring and Observability

The observability stack captures metrics, logs, and traces for every service, with dashboards and alerts derived from service-level objectives.

## Metrics

All services emit Prometheus metrics via the OpenMetrics exposition format. Every metric is tagged with `service`, `env`, `version`, and `region` labels at minimum. Prometheus servers scrape on a 15-second interval and write to Thanos for long-term storage and global query.

Four golden signals — latency, traffic, errors, and saturation — are computed for each service. Derived SLIs feed SLOs defined per endpoint, and alerts are burn-rate based so a fast-burning budget triggers immediately while a slow burn triggers only after sustained degradation.

## Logs

Structured logs are emitted as JSON and shipped by the node-level fluent-bit agent to an Elasticsearch cluster. Indices are sharded by date and retained for 30 days hot, 180 days warm. Logs carry the trace ID so a query can pivot to the originating trace.

Sensitive fields (PII, credentials) are redacted at the source via a shared logging library that maintains a centrally-managed allow-list of fields permitted to contain user data.

## Traces

Distributed tracing uses OpenTelemetry SDKs with OTLP export. The collector pipeline samples 1% of requests baseline, with tail-based sampling keeping 100% of traces with errors or latency exceeding thresholds. Traces are stored in Tempo for 14 days.

## Dashboards

Grafana hosts service dashboards templated per environment. Each service owner maintains a dashboard following a standard layout: SLIs on top, saturation middle, diagnostics bottom. A runbook link is required on every alert.

## On-Call Paging

PagerDuty routes alerts based on the `owner` label. Every alert links to its runbook and grafana dashboard. Pages outside business hours require a synthesized acknowledgement within 5 minutes, else escalation to secondary, then to engineering management.

## Postmortems

Every incident above severity 3 generates a blameless postmortem within five business days. Action items are tracked in Jira, linked to the incident, and reviewed monthly in an operations forum.


## Related Pages

(populated by crosslink hook)
