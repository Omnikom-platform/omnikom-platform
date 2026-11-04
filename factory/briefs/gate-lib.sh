#!/usr/bin/env bash
# Gate steps for the head's land scripts. Source it, then:
#   step "<label>" "<command string>"   runs it under pipefail (a red command inside a pipe stays red), prints the
#                                        last 2 lines, and stops the WHOLE script on a non-zero exit
#   push_check <branch>                  only reached when every step before it passed
# A red step prints "GATE RED: <label> exit <n>" and exits 1, so nothing after it (commit, push) can run.
step() {
  local label="$1" cmd="$2"
  echo "--- $label"
  local out rc
  out=$(bash -o pipefail -c "$cmd" 2>&1); rc=$?
  printf '%s\n' "$out" | tail -n 2
  if [ "$rc" -ne 0 ]; then echo "GATE RED: $label exit $rc"; exit 1; fi
}
push_check() {
  local branch="$1"
  if [ -n "${GATE_DRY:-}" ]; then echo "DRY PUSH $branch"; return 0; fi
  for i in 1 2 3; do git push -q backup-gh "HEAD:refs/heads/$branch" 2>&1 | grep -v '^remote:'; [ "${PIPESTATUS[0]}" = 0 ] && break; done
  git ls-remote backup-gh "refs/heads/$branch"
}
