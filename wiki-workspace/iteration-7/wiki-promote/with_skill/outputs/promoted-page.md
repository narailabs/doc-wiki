---
title: Authentication Flow
type: synthesis
tags: [authentication, jwt, sessions, security]
sources:
  - "outputs/queries/2026-04-14-how-does-authentication-work.md"
  - "https://auth0.com/docs/authenticate/login"
  - "wiki/auth.md"
created: "2026-04-14T17:55:00+00:00"
updated: "2026-04-14T17:55:00+00:00"
summary: "End-to-end authentication flow covering JWT issuance, session management, refresh token rotation, and federated OAuth 2.0 login."
---

# Authentication Flow

Authentication in this system is built around JSON Web Tokens (JWT) combined with a session layer for server-side state management. When a user submits credentials, the auth service validates them against the user store and — upon success — issues a short-lived JWT access token (15 minutes) alongside a long-lived refresh token (7 days). The JWT carries a compact set of claims including the user ID, roles, and expiry, signed with an RS256 key pair managed by the key-management service.

The session mechanism exists primarily to support revocation: each login creates a session record in Redis keyed by the JWT `jti` claim. Middleware on every protected endpoint decodes the JWT, verifies the signature, then performs a fast Redis lookup to confirm the session is still active. If the session key is absent — because a logout or forced-revocation occurred — the request is rejected even though the JWT itself would still be cryptographically valid. This two-layer approach is described further in [auth concepts](../auth.md).

When the access token nears expiry the client exchanges the refresh token for a new JWT access token via the `/auth/refresh` endpoint. The refresh token is a random 256-bit opaque string stored (hashed with SHA-256) in the database, associated with the user's session ID. Refresh token rotation is enforced: each exchange issues a brand-new refresh token and invalidates the previous one. Stolen-token detection relies on detecting reuse of a consumed refresh token, which immediately revokes the entire session family.

Token delivery follows a split-cookie pattern to mitigate XSS and CSRF risks simultaneously. The JWT is stored in an HttpOnly, Secure, SameSite=Strict cookie so that JavaScript cannot read it; the refresh token is stored in a separate HttpOnly cookie scoped to the `/auth/refresh` path only. A CSRF token is embedded in a non-HttpOnly cookie and must be echoed back in the `X-CSRF-Token` header for any state-mutating request.

Federated login via OAuth 2.0 / OpenID Connect is supported for Google and GitHub. In those flows the external identity provider issues its own token, which the auth service exchanges for the provider's user profile. A local user record is upserted and the same JWT + refresh token pair is minted, making the federated path transparent to downstream services. See [auth concepts](../auth.md) for the full provider configuration reference.
