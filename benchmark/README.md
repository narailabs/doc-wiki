# doc-wiki benchmark

> **Superseded (2026-06-10).** The V1 harness and its published runs were withdrawn: sessions ran with unrestricted network access, several curated ticket bodies contained root-cause analysis, and there were no training-data contamination controls. The V2 harness (container isolation, Anthropic-only egress firewall, sanitized tickets, pre-registered calibration) replaces it — see [`docs/superpowers/specs/2026-06-10-benchmark-harness-design.md`](../docs/superpowers/specs/2026-06-10-benchmark-harness-design.md). The curated 25-issue manifest in [`repos.yaml`](repos.yaml) remains valid input and will be re-used (re-sanitized + calibrated) for the V2 django/cal.com/mastodon phase.

The V2 harness is being built in this directory — container-isolated runs, Anthropic-only egress firewall, sanitized ticket bodies, training-data contamination floors, and pre-registered test calibration. Methodology and components: [`docs/superpowers/specs/2026-06-10-benchmark-harness-design.md`](../docs/superpowers/specs/2026-06-10-benchmark-harness-design.md).

What's here today:

- [`repos.yaml`](repos.yaml) — the hand-curated 25-issue manifest (django / cal.com / mastodon), SHAs verified in [`results/curation-report.md`](results/curation-report.md). Retained as input for the V2 full-mix phase.
- [`PLAN.md`](PLAN.md), [`ANALYSIS.md`](ANALYSIS.md), [`PUBLISH.md`](PUBLISH.md), [`dispatch.md`](dispatch.md) — V1 strategy docs, kept for the historical record (see the banner above for why V1 was withdrawn).

The V2 runbook will replace this file when the harness lands.
