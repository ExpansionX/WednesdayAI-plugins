#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  echo "usage: notify.sh <topic> <task-id> <reason>" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage

topic="$1"
task_id="$2"
reason="$3"
run_dir="${WAI_SHOHIN_RUN_DIR:-${WAI_RUN_DIR:-}}"

if [ -z "$run_dir" ]; then
  echo "notify.sh: WAI_RUN_DIR or WAI_SHOHIN_RUN_DIR is required" >&2
  exit 2
fi
case "$run_dir" in
  /*) ;;
  *) echo "notify.sh: run directory must be absolute" >&2; exit 2 ;;
esac

install -d -m 700 "$run_dir"
chmod 700 "$run_dir"

log_file="${WAI_SHOHIN_ATTENTION_LOG:-$run_dir/attention.jsonl}"
case "$log_file" in
  "$run_dir"/*) ;;
  *) echo "notify.sh: attention log must live under the run directory" >&2; exit 2 ;;
esac
mkdir -p "$(dirname "$log_file")"
lock_file="$log_file.lock"

{
  flock -x 200
  python3 - "$log_file" "$topic" "$task_id" "$reason" <<'PY'
import datetime
import json
import sys

log_file, topic, task_id, reason = sys.argv[1:5]
record = {
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "id": task_id,
    "reason": reason,
    "topic": topic,
}
with open(log_file, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    handle.write("\n")
PY
} 200>>"$lock_file"
