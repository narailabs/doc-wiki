# Governance

How doc-wiki is licensed, released, maintained, and decided upon. Stable contract; updates here happen via a normal PR with a 30-day notice period.

## License

doc-wiki is Apache 2.0 licensed via [`LICENSE`](../LICENSE).

**doc-wiki will remain Apache 2.0 forever.** This is a public, dated commitment, not a marketing statement:

- The repository will not be relicensed.
- No future version will be relicensed.
- No "doc-wiki Pro" or "open core" version will replace this one.
- If a future maintainer attempts to relicense, you should fork the last commit at `LICENSE = Apache-2.0` and continue.

The reasoning is published in [`manifesto.md`](manifesto.md). The shorter version: the path tools take to become standards (Terraform, dbt, Backstage) requires a credible no-rug-pull signal, and the path tools take to fracture (Terraform → OpenTofu, Redis → Valkey) requires the opposite. doc-wiki is choosing the standard-track signal.

## Releases

- **Versioning:** SemVer (`major.minor.patch`). Current series: `0.1.x`. The `0.x` line covers all evolution before the surface API freezes; expect occasional minor breaking changes until `1.0.0`.
- **Tags:** every release is a signed git tag (`vX.Y.Z`).
- **Attestation:** release artifacts published via [GitHub Attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations) (sigstore-backed). Verification: `gh attestation verify <artifact>` against this repo.
- **Changelog:** every release ships a `CHANGELOG.md` delta. Backwards-incompatible changes are flagged with `BREAKING:` and explained.

## Maintainership

- **Today:** single maintainer ([rfv](https://github.com/narailabs)).
- **Bus-factor mitigation goal:** 2 named co-maintainers with merge rights by end of 2026-Q4, recruited from active external contributors. Co-maintainers will be listed here as they join.
- **Maintainer commitments:** issue triage within 7 days of filing; security disclosures acknowledged within 72 hours; release cadence at minimum quarterly while the project is active.
- **Project end-of-life policy:** if active maintenance stops, this file will be updated with a public notice ≥90 days before the repository is archived. The Apache-2.0 license guarantees you can fork at any time.

## Security disclosures

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/narailabs/doc-wiki/security/advisories/new) (preferred) or by email to `security@narailabs.dev` _(coming soon — placeholder while the address is being provisioned)_.

- Acknowledgement within 72 hours.
- Initial assessment within 7 days.
- Coordinated disclosure timeline negotiated case-by-case. Default is 90 days.
- Reporters credited in the advisory unless they request anonymity.

Out of scope: vulnerabilities in `narai-primitives` connectors are reported to [that project](https://github.com/narailabs/narai-primitives) directly. Vulnerabilities in Claude Code itself are reported to Anthropic.

## Decision-making

- **Routine changes** (bug fixes, doc edits, new ORM/REST profiles, new connectors) — merged at maintainer discretion after review.
- **API/architecture changes** — proposed via a `docs/proposals/<NNN>-<slug>.md` PR with ≥14 days open for community comment before merge.
- **License changes** — not permitted (see [License](#license)).
- **Foundation move** — if doc-wiki eventually moves under a foundation umbrella (CNCF, Linux Foundation's Agentic AI Foundation, etc.), the move is proposed via the same proposal process. Foundation moves do not change the license.

## Funding & sponsorship

doc-wiki currently has no funding stream. If GitHub Sponsors is enabled in the future, all funds are project-direct (test infrastructure, CI, conference travel) and never gate features. Sponsorship does not grant any influence over project direction.

## Trademark

"doc-wiki" is the project name. There is no registered trademark today. The name is used informally — derivative works (forks, plugins-of-doc-wiki, redistributions) are free to use the name with clear attribution to the upstream project, but should not imply official endorsement.

## Changing this document

Updates to this file are merged via PR with a ≥30-day notice period. The license-forever commitment in the [License](#license) section is the only clause that cannot be changed.
