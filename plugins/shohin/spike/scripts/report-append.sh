#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  echo "usage: report-append.sh <report-file> <heading> <command> <stdout-file> <stderr-file> <status>" >&2
  exit 2
}

[ "$#" -eq 6 ] || usage

report_file="$1"
heading="$2"
command_text="$3"
stdout_file="$4"
stderr_file="$5"
status="$6"

case "$status" in
  ''|*[!0-9]*) echo "report-append.sh: status must be a non-negative integer" >&2; exit 2 ;;
esac
[ -f "$stdout_file" ] || { echo "report-append.sh: stdout file is missing" >&2; exit 2; }
[ -f "$stderr_file" ] || { echo "report-append.sh: stderr file is missing" >&2; exit 2; }

mkdir -p "$(dirname "$report_file")"
lock_file="$report_file.lock"

{
  flock -x 200
  python3 - "$report_file" "$heading" "$command_text" "$stdout_file" "$stderr_file" "$status" <<'PY'
import datetime
import json
import sys

report_file, heading, command_text, stdout_file, stderr_file, status = sys.argv[1:7]
with open(stdout_file, "r", encoding="utf-8", errors="replace") as handle:
    stdout = handle.read()
with open(stderr_file, "r", encoding="utf-8", errors="replace") as handle:
    stderr = handle.read()
record = {
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "command": command_text,
    "heading": heading,
    "status": int(status),
    "stderr": stderr,
    "stdout": stdout,
}
safe_heading = " ".join(heading.replace("\r", " ").replace("\n", " ").split())
if not safe_heading:
    safe_heading = "Evidence"
with open(report_file, "a", encoding="utf-8") as handle:
    handle.write("\n### ")
    handle.write(safe_heading)
    handle.write("\n\n```json\n")
    handle.write(json.dumps(record, ensure_ascii=True, sort_keys=True))
    handle.write("\n```\n")
PY
} 200>>"$lock_file"
