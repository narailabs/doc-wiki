---
title: Deploy Pipeline
tags: [deploy, ci]
---

# Deploy Pipeline

This page documents the deploy pipeline.

<!-- wiki-mermaid: start -->
%% Title: Deploy
```mermaid
flowchart TD
    checkout --> build
    build --> docker
    docker --> push
    push --> deploy
    deploy --> smoke
```
<!-- wiki-mermaid: end -->

## Operational notes

On-call: @deploy-team. Rollbacks are automatic if the smoke check fails.
