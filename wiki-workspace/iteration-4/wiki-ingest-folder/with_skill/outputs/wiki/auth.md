---
title: "Authentication & Authorization"
page_type: reference
sources:
  - /tmp/eval-i4-ingest-folder/docs/auth.md
tags: ["authentication", "oauth", "oidc", "opa-policy", "jwt"]
content_hash: "ea3eba776fd13b2796cfb0816024b5c2c94794ed7a1af6fb3c19dd603bf72d84"
ingested_at: "2026-04-14T20:07:39.829Z"
---
# Authentication & Authorization

# Authentication & Authorization

Authentication issues and verifies identity; authorization decides what an identity is permitted to do. The platform separates these two concerns using OAuth 2.1 for auth and a policy engine (OPA) for authz.

## Authentication Flow

Users authenticate against an OIDC provider (Auth0 for external, Okta for employees). The OIDC flow returns a signed ID token and access token. The access token is a JWT whose claims include the subject (user ID), organization ID, roles, and a scope list.

Service-to-service calls use SPIFFE X.509 identities minted by the service mesh control plane. Every pod gets a short-lived certificate rotated every 24 hours. Downstream services validate the caller's SVID against a mesh-wide trust domain.

## Token Handling

All tokens are validated at the edge by the API Gateway. Validation checks include:

- Signature verification against the JWKS published by the issuer
- Expiration (`exp`) and not-before (`nbf`) checks
- Issuer (`iss`) and audience (`aud`) allow-listing
- Revocation lookup in Redis for tokens flagged by admins

Valid tokens are rewritten into a downstream-only internal header carrying the resolved subject and claims. Services never see the raw access token.

## Authorization

Every service consults an OPA sidecar before performing sensitive operations. Policies are written in Rego and distributed via a bundle server. Decisions are cached for 5 seconds per request context to reduce latency.

Role assignments are stored in the identity service and projected into OPA input documents at token issuance time. This avoids round-trips from the policy engine back to the identity store on the hot path.

## Audit

Every allow/deny decision is logged to an append-only audit stream with the subject, resource, action, outcome, and policy bundle version used. These logs feed the security team's SIEM for anomaly detection.

## Update Note

As of 2026-04-14, short-lived tokens are further restricted to a 15-minute default TTL to reduce blast radius on compromised credentials.


## Related Pages

(populated by crosslink hook)
