# Overview

Evolving big-picture synthesis of the Test Project Wiki.

## Current State (2026-04-14)

The wiki currently covers a single topic area: **authentication and session
management** for our backend services. The design layers stateless JWT
verification (RS256) over a stateful PostgreSQL `sessions` table, with a
dedicated `/auth/refresh` endpoint backed by rotating refresh tokens.

See the [index](index.md) for the full page catalog, or the [summaries
index](summaries.md) for one-paragraph abstracts.
