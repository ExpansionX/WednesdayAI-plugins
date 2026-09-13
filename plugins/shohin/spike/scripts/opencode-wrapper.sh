#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  echo "usage: opencode-wrapper.sh <opencode-argv...>" >&2
  exit 2
}

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    echo "opencode-wrapper.sh: $name is required" >&2
    exit 2
  fi
  printf '%s\n' "$value"
}

now_utc() {
  python3 - <<'PY'
import datetime
print(datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"))
PY
}

now_ns() {
  python3 - <<'PY'
import time
print(time.time_ns())
PY
}

[ "$#" -gt 0 ] || usage

real_opencode="$(require_env WAI_SHOHIN_OPENCODE_BIN)"
call_log="$(require_env WAI_SHOHIN_CALL_LOG)"
role="$(require_env WAI_SHOHIN_ROLE)"
model="$(require_env WAI_SHOHIN_MODEL)"
attempt="$(require_env WAI_SHOHIN_ATTEMPT)"
run_dir="${WAI_SHOHIN_RUN_DIR:-${WAI_RUN_DIR:-}}"

if [ -z "$run_dir" ]; then
  echo "opencode-wrapper.sh: WAI_RUN_DIR or WAI_SHOHIN_RUN_DIR is required" >&2
  exit 2
fi
case "$run_dir" in
  /*) ;;
  *) echo "opencode-wrapper.sh: run directory must be absolute" >&2; exit 2 ;;
esac
case "$call_log" in
  /*) ;;
  *) echo "opencode-wrapper.sh: call log must be absolute" >&2; exit 2 ;;
esac
case "$call_log" in
  "$run_dir"/*) ;;
  *) echo "opencode-wrapper.sh: call log must live under the run directory" >&2; exit 2 ;;
esac
case "$attempt" in
  ''|*[!0-9]*) echo "opencode-wrapper.sh: WAI_SHOHIN_ATTEMPT must be a non-negative integer" >&2; exit 2 ;;
esac
[ -x "$real_opencode" ] || { echo "opencode-wrapper.sh: WAI_SHOHIN_OPENCODE_BIN is not executable" >&2; exit 2; }

install -d -m 700 "$run_dir"
chmod 700 "$run_dir"
mkdir -p "$(dirname "$call_log")"
calls_root="$run_dir/opencode-calls"
install -d -m 700 "$calls_root"
chmod 700 "$calls_root"
call_dir="$(mktemp -d "$calls_root/call-XXXXXX")"
chmod 700 "$call_dir"

stdout_file="$call_dir/stdout.ndjson"
stderr_file="$call_dir/stderr.log"
stdout_pipe="$call_dir/stdout.pipe"
stderr_pipe="$call_dir/stderr.pipe"
record_error="$call_dir/record-error.log"
mkfifo "$stdout_pipe" "$stderr_pipe"

start_utc="$(now_utc)"
start_ns="$(now_ns)"
tee "$stdout_file" < "$stdout_pipe" &
stdout_tee_pid="$!"
tee "$stderr_file" < "$stderr_pipe" >&2 &
stderr_tee_pid="$!"

set +e
"$real_opencode" "$@" > "$stdout_pipe" 2> "$stderr_pipe"
status="$?"
set -e

wait "$stdout_tee_pid" || true
wait "$stderr_tee_pid" || true
rm -f "$stdout_pipe" "$stderr_pipe"
end_utc="$(now_utc)"
end_ns="$(now_ns)"

lock_file="$call_log.lock"
if ! {
  flock -x 200
  python3 - "$call_log" "$role" "$model" "$attempt" "$start_utc" "$end_utc" "$start_ns" "$end_ns" "$status" "$stdout_file" "$stderr_file" "$@" <<'PY'
import json
import pathlib
import sys

(
    call_log,
    role,
    model,
    attempt,
    start_utc,
    end_utc,
    start_ns,
    end_ns,
    status,
    stdout_file,
    stderr_file,
    *argv,
) = sys.argv[1:]

secret_markers = ("auth", "key", "password", "secret", "token")
value_options = {
    "-m",
    "--model",
    "--dir",
    "--attach",
    "--format",
    "--output-format",
    "--permission-mode",
    "--settings",
}

def secret_like(value):
    lowered = value.lower()
    return any(marker in lowered for marker in secret_markers)

def redact_argv(values):
    redacted = []
    index = 0
    while index < len(values):
        value = values[index]
        if index == 0:
            redacted.append("[redacted-secret]" if secret_like(value) else value)
            index += 1
            continue
        if value in value_options and index + 1 < len(values):
            redacted.append(value)
            next_value = values[index + 1]
            redacted.append(
                "[redacted-secret]" if secret_like(value) or secret_like(next_value) else next_value
            )
            index += 2
            continue
        if value.startswith("-"):
            redacted.append("[redacted-secret]" if secret_like(value) else value)
            index += 1
            continue
        redacted.append("[redacted-prompt]")
        index += 1
    return redacted

def usage_from_stdout(path):
    raw = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
    records = []
    parsed_whole = False
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            parsed_whole = True
            usage = obj.get("usage")
            if isinstance(usage, dict):
                total = usage.get("total_tokens", 0) or 0
                if isinstance(total, int):
                    records.append({"source": "stdout-json", "total_tokens": total})
    except Exception:
        pass
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        usage = obj.get("usage")
        if isinstance(usage, dict) and not parsed_whole:
            total = usage.get("total_tokens", 0) or 0
            if isinstance(total, int):
                records.append({"source": "stdout-ndjson", "total_tokens": total})
    return records

usage_records = usage_from_stdout(stdout_file)
total_tokens = sum(record["total_tokens"] for record in usage_records)
attempt_int = int(attempt)
status_int = int(status)
elapsed_ms = max(0, (int(end_ns) - int(start_ns)) // 1_000_000)
call = {
    "argv": redact_argv(argv),
    "attempt": attempt_int,
    "elapsed_ms": elapsed_ms,
    "end": end_utc,
    "kind": "opencode_call",
    "model": model,
    "role": role,
    "start": start_utc,
    "status": status_int,
    "stderr_path": stderr_file,
    "stdout_path": stdout_file,
    "total_tokens": total_tokens,
    "usage_records": usage_records,
}
usage = {
    "attempt": attempt_int,
    "end": end_utc,
    "estimated_usd": None,
    "kind": "token_usage",
    "model": model,
    "role": role,
    "source": "opencode-wrapper",
    "start": start_utc,
    "status": status_int,
    "total_tokens": total_tokens,
}
with open(call_log, "a", encoding="utf-8") as handle:
    for record in (call, usage):
        handle.write(json.dumps(record, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
        handle.write("\n")
PY
} 200>>"$lock_file" 2>>"$record_error"; then
  :
fi

exit "$status"
