#!/usr/bin/env sh
# Runs every self-test in scripts/ one after another and writes one log per test to $1 (default: runs/_tests).
# Exit code of each test is recorded; nothing else is interpreted. Used for the overhaul baseline and after-edit gates.
set -u
OUT="${1:-runs/_tests}"
mkdir -p "$OUT"
cd "$(dirname "$0")/.."
SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
for t in scripts/test-*.mjs scripts/mutants-research.mjs; do
  name=$(basename "$t" .mjs)
  start=$(date +%s)
  node "$t" > "$OUT/$name.log" 2>&1
  code=$?
  end=$(date +%s)
  printf '%s exit=%s secs=%s\n' "$name" "$code" "$((end-start))" | tee -a "$SUMMARY"
done
echo "DONE" >> "$SUMMARY"
