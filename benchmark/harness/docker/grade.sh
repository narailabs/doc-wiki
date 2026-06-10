#!/usr/bin/env bash
# Grade one run. env: BENCH_BASE_COMMIT, BENCH_FIX_COMMIT, BENCH_TEST_FILES, BENCH_TEST_COMMAND, BENCH_RETRIES
# Local mode (tests/e2e): BENCH_BARE_DIR + BENCH_OUT_DIR override /bare and /out.
# Modes via BENCH_GRADE_MODE: grade (default) | calibrate-base | calibrate-fix
# exit: 0 tests-passed | 10 apply-failed | 20 tests-failed | 64 setup error
set -uo pipefail
BARE="${BENCH_BARE_DIR:-/bare}"
OUT="${BENCH_OUT_DIR:-/out}"
MODE="${BENCH_GRADE_MODE:-grade}"

work="$(mktemp -d)"
git clone --no-hardlinks -q "$BARE" "$work" || exit 64
cd "$work" || exit 64

run_tests() {
  local cmd="${BENCH_TEST_COMMAND//\{test_files\}/$BENCH_TEST_FILES}"
  bash -ec "$cmd"
}

case "$MODE" in
  calibrate-base)
    git checkout -q "$BENCH_BASE_COMMIT" || exit 64
    # shellcheck disable=SC2086
    git checkout -q "$BENCH_FIX_COMMIT" -- $BENCH_TEST_FILES || exit 64
    run_tests && exit 20 || exit 0   # tests MUST fail on base: failing = calibration ok (0)
    ;;
  calibrate-fix)
    git checkout -q "$BENCH_FIX_COMMIT" || exit 64
    run_tests && exit 0 || exit 20   # tests MUST pass on fix
    ;;
  grade)
    git checkout -q "$BENCH_BASE_COMMIT" || exit 64
    # Guard: git 2.50+ rejects empty input without --allow-empty; an empty patch is a no-op.
    if [ -s "$OUT/diff.patch" ]; then
      git apply --index --binary --whitespace=nowarn "$OUT/diff.patch" || exit 10
    fi
    # shellcheck disable=SC2086
    git checkout -q "$BENCH_FIX_COMMIT" -- $BENCH_TEST_FILES || exit 64
    if run_tests; then exit 0; fi
    if [ "${BENCH_RETRIES:-0}" -ge 1 ]; then
      run_tests && exit 0
    fi
    exit 20
    ;;
  *) exit 64 ;;
esac
