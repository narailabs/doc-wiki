# Skipped evals — live-API agents

The 18 prompts below are defined in the repo's agent `evals/evals.json` files but were **not run** in iteration-2 because they require credentials to external services that are not available in this environment. Each entry names the missing credential so a future session with access can extend the coverage matrix.

Decision recorded during planning: "Everything, skip live APIs" — prompts are enumerated here rather than silently omitted.

## wiki-github-agent (3 prompts)

Missing: `GITHUB_TOKEN` with read access to the target repo/org.

1. `id: 1` — Fetch repo metadata for a given owner/repo.
2. `id: 2` — List recent pull requests for a repo with their titles and authors.
3. `id: 3` — Read the content of a single file from a repo at HEAD.

## wiki-jira-agent (3 prompts)

Missing: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.

1. `id: 1` — Fetch the details of a single Jira issue by key.
2. `id: 2` — Run a JQL search and return the matching issues.
3. `id: 3` — List projects accessible to the authenticated user.

## wiki-confluence-agent (3 prompts)

Missing: `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`.

1. `id: 1` — Fetch a single Confluence page by ID with rendered body.
2. `id: 2` — Run a CQL search and return matching pages.
3. `id: 3` — List spaces accessible to the authenticated user.

## wiki-gcp-agent (3 prompts)

Missing: `gcloud` CLI authentication (`gcloud auth application-default login`) plus a project ID.

1. `id: 1` — Describe a Cloud SQL instance and its databases.
2. `id: 2` — List Pub/Sub topics in a project and their subscriber counts.
3. `id: 3` — Fetch recent Cloud Logging entries matching a severity filter.

## wiki-aws-agent (3 prompts)

Missing: AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or an assumed-role profile).

1. `id: 1` — List Lambda functions in a region with their runtime + last-modified time.
2. `id: 2` — Describe an RDS instance including engine, storage, and VPC config.
3. `id: 3` — Fetch CloudWatch metrics for a named Lambda over the last 24 hours.

## wiki-notion-agent (3 prompts)

Missing: `NOTION_API_KEY` (internal integration secret) with access to the target workspace.

1. `id: 1` — Fetch a Notion page by ID and return its blocks.
2. `id: 2` — Query a Notion database with a filter and return matching rows.
3. `id: 3` — Search the workspace for pages matching a text query.

---

**Total skipped:** 18 prompts across 6 agents.
**Suggested follow-up:** set the relevant env vars, create a new iteration directory (e.g., `iteration-3-live/`), and re-run using the same `eval_metadata.json` pattern used in this iteration.
