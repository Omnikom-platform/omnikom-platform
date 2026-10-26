#!/usr/bin/env sh
# scenarios of test-start.mjs without mutants; prints only the failures and the verdict line; exits with the TEST's own exit code
cd "$(dirname "$0")/../.."
LOG="runs/_after/start-scenarios.log"
node scripts/test-start.mjs --no-mutants > "$LOG" 2>&1
code=$?
grep -A2 -E "^FAIL|TEST (PASS|FAIL)" "$LOG" | cut -c1-400 | head -20
echo "exit=$code"
exit $code
