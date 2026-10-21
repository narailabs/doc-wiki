---
title: "Deployment Pipeline"
page_type: reference
sources:
  - /tmp/eval-i4-ingest-folder/docs/deployment.md
tags: ["ci-cd", "argocd", "canary-rollout", "cosign", "vault-secrets"]
content_hash: "e474e1f2e49c012ececb7b0a5c3ce5b3e963ddd24c1f5f13c1b450516dd5a495"
ingested_at: "2026-04-14T20:07:09.140Z"
---
# Deployment Pipeline

# Deployment Pipeline

Every code change flows through the same pipeline from commit to production: build, test, sign, stage, canary, and rollout. No human touches the pipeline between merge and production except for the canary gate.

## Build and Test

Commits to the `main` branch trigger GitHub Actions. The pipeline builds container images for each affected service using Bazel for deterministic output, then runs unit, integration, and contract tests in parallel. Test results post back to the PR; failures block the merge.

After tests pass, images are signed with cosign keys held in the CI KMS. Signatures are stored in the container registry, and downstream steps verify signatures before pulling.

## Staging

Images are deployed to the staging environment using Argo CD. A suite of synthetic probes exercises the critical paths end-to-end. A soak period of at least 30 minutes must pass without alerts before promotion to canary.

## Canary Rollout

Canary uses a traffic-split at the mesh: 1% of production traffic is routed to the new version for 10 minutes, then 5% for 20 minutes, then 25%, then 100%. Each step evaluates a rolling window of SLIs: error rate, p95 latency, saturation. If any SLI breaches its budget, the rollout automatically reverts.

## Rollouts and Rollbacks

The full rollout uses a max-surge of 25% and max-unavailable of 0 to preserve capacity during deploys. Rollbacks are one-click through Argo — the previous known-good revision is preserved and can be reapplied in under 60 seconds.

## Release Windows

Production deploys are paused during declared business windows (holiday freezes, end-of-quarter close). Emergency hotfixes bypass the pause only with explicit on-call commander approval.

## Secrets Management

Secrets are pulled at runtime from Vault using Kubernetes service account tokens. No secret ever lands in a container image or a Helm chart. Vault audit logs feed the same SIEM as authentication decisions.


## Related Pages

(populated by crosslink hook)
