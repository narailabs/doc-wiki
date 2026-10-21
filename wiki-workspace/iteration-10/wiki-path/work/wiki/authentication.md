---
title: Authentication
type: concept
tags: [authentication, jwt, oauth, security]
sources: [raw/auth.md]
created: 2026-04-25
updated: 2026-04-25
summary: Login, JWT issuance, and how the auth subsystem hands off to the session store.
---

# Authentication

The authentication subsystem issues JWTs after credential validation and writes
the resulting session row into the session store.
