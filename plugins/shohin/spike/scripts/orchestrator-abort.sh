#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  echo "usage: orchestrator-abort.sh <envelope-file> <repo-root>" >&2
  exit 2
}

realpath_py() {
  python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

now_utc() {
  python3 - <<'PY'
import datetime
print(datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"))
PY
}

[ "$#" -eq 2 ] || usage

envelope_file="$1"
repo_root="$2"
[ -f "$envelope_file" ] || { echo "orchestrator-abort.sh: envelope file is missing" >&2; exit 2; }
[ -r "$envelope_file" ] || { echo "orchestrator-abort.sh: envelope file is not readable" >&2; exit 2; }
[ -d "$repo_root" ] || { echo "orchestrator-abort.sh: repo root is missing" >&2; exit 2; }

repo_abs="$(realpath_py "$repo_root")"
git_top="$(git -C "$repo_abs" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "orchestrator-abort.sh: repo root must be a git worktree" >&2
  exit 2
}
git_top_abs="$(realpath_py "$git_top")"
if [ "$repo_abs" != "$git_top_abs" ]; then
  echo "orchestrator-abort.sh: repo root must be the git worktree root" >&2
  exit 2
fi

start_utc="$(now_utc)"
decision="$(
  python3 - "$envelope_file" <<'PY'
import json
import re
import sys

with open(sys.argv[1], "r", encoding="utf-8", errors="replace") as handle:
    envelope = handle.read()

items = []
for match in re.finditer(r"(?m)^- task=([^ \t\r\n]+) kind=([^ \t\r\n]+) reason=(.*)$", envelope):
    task_id, kind, reason = match.groups()
    reason = re.sub(r"[\r\n\t]+", " ", reason).strip()
    if reason:
        text = f"deterministic abort for {kind}: {reason}"
    else:
        text = f"deterministic abort for {kind}"
    items.append({"decision": "abort", "reason": text, "task_id": task_id})

if not items:
    seen = set()
    for match in re.finditer(r"(?m)^### task ([^ \t\r\n(]+)", envelope):
        task_id = match.group(1)
        if task_id in seen:
            continue
        seen.add(task_id)
        items.append(
            {
                "decision": "abort",
                "reason": "deterministic abort: no open attention item details",
                "task_id": task_id,
            }
        )

if not items:
    items.append(
        {
            "decision": "abort",
            "reason": "deterministic abort: no attended task id in envelope",
            "task_id": "__unknown__",
        }
    )

print(json.dumps({"items": items, "overall": "abort"}, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
PY
)"
end_utc="$(now_utc)"
printf '%s\n' "$decision"

if [ -n "${WAI_SHOHIN_CALL_LOG:-}" ]; then
  call_log="$WAI_SHOHIN_CALL_LOG"
  case "$call_log" in
    /*) ;;
    *) echo "orchestrator-abort.sh: WAI_SHOHIN_CALL_LOG must be absolute" >&2; exit 2 ;;
  esac
  mkdir -p "$(dirname "$call_log")"
  lock_file="$call_log.lock"
  {
    flock -x 200
    python3 - "$call_log" "${WAI_SHOHIN_ATTEMPT:-0}" "$start_utc" "$end_utc" <<'PY'
import json
import sys

call_log, attempt, start_utc, end_utc = sys.argv[1:5]
try:
    attempt_int = int(attempt)
except ValueError:
    attempt_int = 0
record = {
    "attempt": attempt_int,
    "end": end_utc,
    "estimated_usd": 0,
    "kind": "token_usage",
    "model": "deterministic-assessor",
    "role": "assessor",
    "source": "orchestrator-abort",
    "start": start_utc,
    "status": 0,
    "total_tokens": 0,
}
with open(call_log, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    handle.write("\n")
PY
  } 200>>"$lock_file"
fi
