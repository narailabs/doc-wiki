#!/usr/bin/env bash
# Modes: entrypoint.sh session | entrypoint.sh grade
# session env: BENCH_BASE_COMMIT, BENCH_MODEL, BENCH_MAX_TURNS, BENCH_INSTALL, CLAUDE_CODE_OAUTH_TOKEN
#              BENCH_SKIP_FIREWALL=1 skips the egress lockdown in session mode (wiki-build has full egress by construction — it never reaches the firewall)
# mounts:     /bare (ro bare clone), /out (rw artifacts), /wiki (ro overlay, wiki arm only)
set -uo pipefail

mode="${1:?usage: entrypoint.sh session|grade|wiki-build}"
if [ "$mode" = "grade" ]; then
  exec /usr/local/bin/grade.sh
fi

if [ "$mode" = "wiki-build" ]; then
  set -e
  git clone --no-hardlinks /bare /work && cd /work
  git checkout -q "$BENCH_BASE_COMMIT"
  git config user.email bench@localhost && git config user.name bench
  claude -p "/doc-wiki:init --yes" --plugin-dir /plugin --model "$BENCH_MODEL" --max-turns 300 --output-format json --dangerously-skip-permissions >/out/init.json 2>/out/init.err
  claude -p "/doc-wiki:atlas --cross-service --yes" --plugin-dir /plugin --model "$BENCH_MODEL" --max-turns 300 --output-format json --dangerously-skip-permissions >/out/atlas.json 2>/out/atlas.err
  # Copy exactly what doc-wiki generated/modified (new untracked paths + tracked edits), nothing else.
  # Extract into /out/overlay so the diagnostic envelopes above never leak into the wiki arm's workspace.
  rm -rf /out/overlay && mkdir -p /out/overlay # rebuilds must not inherit stale files from a previous overlay
  { git ls-files --others --exclude-standard -z; git diff --name-only -z; } \
    | sort -zu \
    | tar --null -cf - -T - \
    | tar -C /out/overlay -xf -
  exit 0
fi

set -e
git clone --no-hardlinks /bare /work
cd /work
git checkout -q "$BENCH_BASE_COMMIT"
git config user.email bench@localhost && git config user.name bench

# Install with normal egress (package registries), BEFORE the firewall comes up.
bash -ec "$BENCH_INSTALL"

# Wiki arm: overlay the pre-built wiki + CLAUDE.md pointer at the repo root.
# Committed immediately so the agent's delta is measured against the overlay commit.
if [ -d /wiki ]; then
  cp -R /wiki/. /work/
  git add -A
  git commit -qm "bench: wiki overlay (excluded from agent diff)"
  # Manifest of overlay paths (NUL-separated): agent edits to these are excluded
  # from diff.patch — grading applies the diff at base_commit, where they don't exist.
  git show --format= --name-only -z HEAD >/tmp/overlay-files.nul
fi

# From here on: Anthropic-only egress. The session cannot look up the real fix.
[ "${BENCH_SKIP_FIREWALL:-0}" = "1" ] || sudo /usr/local/bin/init-firewall.sh # entrypoint runs as non-root; iptables needs root (scoped NOPASSWD rule)

set +e
claude -p "$(cat /out/prompt.txt)" \
  --model "$BENCH_MODEL" \
  --max-turns "$BENCH_MAX_TURNS" \
  --output-format json \
  --dangerously-skip-permissions \
  >/out/result.json 2>/out/stderr.log
echo "$?" >/out/exit_code
set -e

# Capture the agent's full working-tree delta (incl. new files). The wiki overlay
# was committed pre-session, so diff.patch contains only the agent's work; any agent
# edits to overlay files are reverted first — they can't apply at base_commit and
# would otherwise sink the wiki arm as apply-failed by construction.
git add -A
if [ -s /tmp/overlay-files.nul ]; then
  git checkout HEAD --pathspec-from-file=/tmp/overlay-files.nul --pathspec-file-nul -- 2>/dev/null || true
fi
git diff --cached --binary >/out/diff.patch

# Publish the transcript for auditability — strip credential files and redact the token.
mkdir -p /out/transcript
cp -R "$CLAUDE_CONFIG_DIR"/. /out/transcript/ 2>/dev/null || true
find /out/transcript -type f \( -name ".credentials.json" -o -name "*credential*" \) -delete 2>/dev/null || true
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  esc=$(printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" | sed 's/[&/\]/\\&/g')
  grep -rlF "$CLAUDE_CODE_OAUTH_TOKEN" /out/transcript 2>/dev/null | while IFS= read -r f; do
    sed -i "s/$esc/[redacted-token]/g" "$f"
  done || true # grep exits 1 when nothing leaked — the happy path must not abort the entrypoint
fi
