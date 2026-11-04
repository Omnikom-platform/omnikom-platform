#!/usr/bin/env bash
# Watched red for gate-lib.sh: a red step must stop the script before the push; a green run must reach it.
D=$(dirname "$0")
run() { bash -c "source '$D/gate-lib.sh'; GATE_DRY=1; $1; push_check check/test/never" 2>&1; }
fails=0
out=$(run "step ok 'true'; step red 'false'; step after 'true'"); rc=$?
if [ $rc -ne 0 ] && grep -q "GATE RED: red exit 1" <<<"$out" && ! grep -q "DRY PUSH" <<<"$out" && ! grep -q -- "--- after" <<<"$out"; then
  echo "PASS a red step stops the script: no later step, no push"; else echo "FAIL red step did not stop the script (rc $rc): $out"; fails=1; fi
out=$(run "step piped 'node -e \"process.exit(3)\" | tail -n 1'"); rc=$?
if [ $rc -ne 0 ] && grep -q "GATE RED: piped exit 3" <<<"$out" && ! grep -q "DRY PUSH" <<<"$out"; then
  echo "PASS a red command inside a pipe stops the script (pipefail)"; else echo "FAIL a pipe hid the red exit: $out"; fails=1; fi
out=$(run "step ok 'true'; step ok2 'echo hi | tail -n 1'"); rc=$?
if [ $rc -eq 0 ] && grep -q "DRY PUSH check/test/never" <<<"$out"; then
  echo "PASS a green run reaches the push"; else echo "FAIL green run did not reach the push (rc $rc): $out"; fails=1; fi
[ $fails = 0 ] && echo "GATE-LIB TESTS OK" || { echo "GATE-LIB TESTS FAILED"; exit 1; }
