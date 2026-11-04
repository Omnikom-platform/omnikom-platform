#!/usr/bin/env bash
# Usage: push-and-land.sh <sha> <branch>. Pushes <sha> to <branch> on backup-gh (3 tries on network errors),
# then runs `omnikom land <branch>` (3 tries, retried only when the output names a connection failure).
sha="$1"; br="$2"; cd "E:/Omnikom Platform" || exit 2
for i in 1 2 3; do
  out=$(git push -q backup-gh "$sha:refs/heads/$br" 2>&1); rc=$?
  [ $rc -eq 0 ] && { echo "PUSHED $sha -> $br (try $i)"; break; }
  echo "push try $i failed: $(echo "$out" | tail -1)"; [ $i -eq 3 ] && { echo "PUSH FAILED"; exit 1; }; sleep 20
done
for i in 1 2 3; do
  out=$(node tools/omnikom-cli/omnikom.mjs land "$br" 2>&1); rc=$?
  echo "$out" | tail -6
  [ $rc -eq 0 ] && { echo "LANDED (try $i)"; exit 0; }
  echo "$out" | grep -q "Could not connect\|unable to access" || { echo "LAND REFUSED exit $rc"; exit $rc; }
  echo "land try $i: network"; sleep 20
done
echo "LAND FAILED on network after 3 tries"; exit 1
