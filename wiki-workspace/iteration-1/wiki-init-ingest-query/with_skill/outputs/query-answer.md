---
query: "what is authentication?"
timestamp: "2026-04-12T16:55:24+00:00"
sources_consulted:
  - wiki/authentication.md
  - wiki/api-endpoints.md
  - wiki/database-schema.md
relevance_scores:
  authentication.md: 0.95
  api-endpoints.md: 0.70
  database-schema.md: 0.45
---

# What is Authentication?

## Answer

The authentication system in this project provides secure user identity verification and session management through three complementary strategies:

### 1. JWT Token Authentication (Primary)

JSON Web Tokens are the primary mechanism for API authentication. The flow works as follows:

- A user submits credentials to `POST /api/v1/auth/login` ([api-endpoints.md](../../wiki/api-endpoints.md))
- The server validates the credentials against bcrypt-hashed passwords stored in the `users` table ([database-schema.md](../../wiki/database-schema.md))
- On success, the server issues two tokens ([authentication.md](../../wiki/authentication.md)):
  - **Access token** (15-minute lifetime) -- contains user ID, roles, and expiration; signed with RS256 using rotating key pairs
  - **Refresh token** (7-day lifetime) -- used to obtain new access tokens via `POST /api/v1/auth/refresh` without re-entering credentials
- All authenticated API requests must include the access token as a Bearer token in the Authorization header ([api-endpoints.md](../../wiki/api-endpoints.md))

### 2. Session-Based Authentication (Browser Clients)

For browser-based clients, the system provides Redis-backed server-side sessions ([authentication.md](../../wiki/authentication.md)):

- Sessions are identified by secure, HTTP-only cookies with `SameSite=Strict`
- Session data includes user profile, active permissions, and CSRF tokens
- Sessions expire after 30 minutes of inactivity with automatic extension on activity
- Users can view and revoke active sessions from account settings

### 3. OAuth 2.0 (Third-Party Providers)

The system supports external identity providers for single sign-on ([authentication.md](../../wiki/authentication.md)):

- Supported providers: **Google**, **GitHub**, **Microsoft**
- Uses Authorization Code flow with PKCE for security
- OAuth flow starts at `GET /api/v1/auth/oauth/:provider` ([api-endpoints.md](../../wiki/api-endpoints.md))
- After successful OAuth exchange, the system creates or links a local user account and issues standard JWT tokens
- Provider configuration (client ID, encrypted secret, URLs, scopes) is stored in the `oauth_providers` database table

### Security Measures

- Passwords: bcrypt hashing with cost factor 12, minimum 12 characters, 5-password history ([authentication.md](../../wiki/authentication.md))
- Rate limiting: 5 failed login attempts per 15-minute window per account
- User credentials stored in the `users` table with VARCHAR(60) password_hash column ([database-schema.md](../../wiki/database-schema.md))

## Contradictions

None detected. The three source documents are consistent in their description of the authentication system.

## Knowledge Gaps

- **Token revocation**: The refresh token invalidation on logout is mentioned, but there is no documented strategy for revoking compromised access tokens before expiry (e.g., token blacklist).
- **MFA/2FA**: No mention of multi-factor authentication support.
- **OAuth provider table schema**: The `oauth_providers` table is referenced but not included in the database schema documentation.
- **Redis configuration**: Session store uses Redis, but Redis connection details and clustering setup are not documented.
