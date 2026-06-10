#!/usr/bin/env bash
# Modes: entrypoint.sh session | entrypoint.sh grade
# session env: BENCH_BASE_COMMIT, BENCH_MODEL, BENCH_MAX_TURNS, BENCH_INSTALL, CLAUDE_CODE_OAUTH_TOKEN
#              BENCH_SKIP_FIREWALL=1 skips the egress lockdown (wiki-build only)
# mounts:     /bare (ro bare clone), /out (rw artifacts), /wiki (ro overlay, wiki arm only)
set -uo pipefail

mode="${1:?usage: entrypoint.sh session|grade}"
if [ "$mode" = "grade" ]; then
  exec /usr/local/bin/grade.sh
fi

set -e
git clone --no-hardlinks /bare /work
cd /work
git checkout -q "$BENCH_BASE_COMMIT"
git config user.email bench@localhost && git config user.name bench

# Install with normal egress (package registries), BEFORE the firewall comes up.
bash -ec "$BENCH_INSTALL"

# Wiki arm: overlay the pre-built wiki + CLAUDE.md pointer at the repo root.
if [ -d /wiki ]; then
  cp -R /wiki/. /work/
fi

# From here on: Anthropic-only egress. The session cannot look up the real fix.
[ "${BENCH_SKIP_FIREWALL:-0}" = "1" ] || /usr/local/bin/init-firewall.sh

set +e
claude -p "$(cat /out/prompt.txt)" \
  --model "$BENCH_MODEL" \
  --max-turns "$BENCH_MAX_TURNS" \
  --output-format json \
  --dangerously-skip-permissions \
  >/out/result.json 2>/out/stderr.log
echo "$?" >/out/exit_code
set -e

# Capture the agent's full working-tree delta (incl. new files), minus any wiki overlay noise.
git add -A
git diff --cached --binary >/out/diff.patch

# Publish the transcript for auditability.
mkdir -p /out/transcript
cp -R "$CLAUDE_CONFIG_DIR"/. /out/transcript/ 2>/dev/null || true
