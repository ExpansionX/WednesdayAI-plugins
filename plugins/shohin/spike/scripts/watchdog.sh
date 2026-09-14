#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  echo "usage: watchdog.sh --scope-id <id.scope> --run-dir <dir> --heartbeat <file> --heartbeat-stale-ms <ms> --heartbeat-poll-ms <ms> [--probe-mode] [--strace-execve] [--record-setsid-descendant] [--disable-watchdog] -- <runner> [args...]" >&2
  exit 2
}

fail_closed() {
  echo "watchdog.sh: cgroup.kill unavailable; fail-closed: $1" >&2
  exit 125
}

fail_usage() {
  echo "watchdog.sh: $1" >&2
  exit 2
}

scope_id=""
run_dir=""
heartbeat=""
stale_ms=""
poll_ms=""
probe_mode=0
strace_execve=0
record_setsid=0
disable_watchdog=0
setsid_pid=""
watchdog_cgroup_root="${WAI_SHOHIN_WATCHDOG_CGROUP_ROOT:-/sys/fs/cgroup}"
watchdog_proc_cgroup="${WAI_SHOHIN_WATCHDOG_PROC_CGROUP:-/proc/self/cgroup}"
heartbeat_now_ms=""
heartbeat_mtime_ms=""
heartbeat_age_ms=""
heartbeat_reason="not_checked"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --scope-id)
      [ "$#" -ge 2 ] || usage
      scope_id="$2"
      shift 2
      ;;
    --run-dir)
      [ "$#" -ge 2 ] || usage
      run_dir="$2"
      shift 2
      ;;
    --heartbeat)
      [ "$#" -ge 2 ] || usage
      heartbeat="$2"
      shift 2
      ;;
    --heartbeat-stale-ms)
      [ "$#" -ge 2 ] || usage
      stale_ms="$2"
      shift 2
      ;;
    --heartbeat-poll-ms)
      [ "$#" -ge 2 ] || usage
      poll_ms="$2"
      shift 2
      ;;
    --probe-mode)
      probe_mode=1
      shift
      ;;
    --strace-execve)
      strace_execve=1
      shift
      ;;
    --record-setsid-descendant)
      record_setsid=1
      shift
      ;;
    --disable-watchdog)
      disable_watchdog=1
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      usage
      ;;
  esac
done

[ "$#" -gt 0 ] || usage

case "$scope_id" in
  shohin-*.scope) ;;
  *) fail_usage "scope id must be the full shohin .scope Id" ;;
esac
case "$scope_id" in
  */*|*\\*|*" "*|*"	"*) fail_usage "scope id contains an unsafe character" ;;
esac
case "$run_dir" in
  /*) ;;
  *) fail_usage "run directory must be absolute" ;;
esac
case "$heartbeat" in
  "$run_dir"/*) ;;
  *) fail_usage "heartbeat must live under the run directory" ;;
esac
case "$stale_ms" in
  ''|*[!0-9]*) fail_usage "heartbeat stale milliseconds must be numeric" ;;
esac
case "$poll_ms" in
  ''|*[!0-9]*) fail_usage "heartbeat poll milliseconds must be numeric" ;;
esac
[ "$stale_ms" -gt 0 ] || fail_usage "heartbeat stale milliseconds must be positive"
[ "$poll_ms" -gt 0 ] || fail_usage "heartbeat poll milliseconds must be positive"

if [ "$probe_mode" -ne 1 ] && {
  [ "$strace_execve" -eq 1 ] ||
    [ "$record_setsid" -eq 1 ] ||
    [ "$disable_watchdog" -eq 1 ]
}; then
  fail_usage "probe-only controls require explicit probe mode"
fi
if [ "$probe_mode" -ne 1 ] && {
  [ "${WAI_SHOHIN_WATCHDOG_CGROUP_ROOT+x}" = x ] ||
    [ "${WAI_SHOHIN_WATCHDOG_PROC_CGROUP+x}" = x ]
}; then
  fail_usage "watchdog cgroup test overrides require explicit probe mode"
fi
case "$watchdog_cgroup_root" in
  /*) ;;
  *) fail_usage "watchdog cgroup root must be absolute" ;;
esac
case "$watchdog_proc_cgroup" in
  /*) ;;
  *) fail_usage "watchdog proc cgroup path must be absolute" ;;
esac

install -d -m 700 "$run_dir"
chmod 700 "$run_dir"

cleanup() {
  if [ -n "$setsid_pid" ]; then
    kill "$setsid_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

read_proc_start_time() {
  local pid="$1"
  local stat_line rest
  IFS= read -r stat_line <"/proc/$pid/stat" || return 1
  rest="${stat_line##*) }"
  set -- $rest
  [ "$#" -ge 20 ] || return 1
  printf '%s\n' "${20}"
}

record_setsid_descendant() {
  command -v setsid >/dev/null 2>&1 || fail_usage "setsid is unavailable"
  local marker marker_file tmp_file start_time
  marker="shohin-setsid-${scope_id}-$$"
  marker_file="$run_dir/setsid-descendant.json"
  tmp_file="$marker_file.tmp.$$"

  setsid env WAI_SHOHIN_SETSID_MARKER="$marker" sleep "${WAI_SHOHIN_SETSID_SLEEP_SECONDS:-600}" &
  setsid_pid="$!"
  start_time="$(read_proc_start_time "$setsid_pid")" || {
    kill "$setsid_pid" 2>/dev/null || true
    fail_usage "could not read setsid descendant start time"
  }
  printf '{"marker":"%s","pid":%s,"start_time":"%s"}\n' \
    "$marker" "$setsid_pid" "$start_time" >"$tmp_file"
  mv -f "$tmp_file" "$marker_file"
}

derive_cgroup_kill_file() {
  local line rel
  while IFS= read -r line; do
    case "$line" in
      0::/*)
        rel="${line#0::}"
        case "$rel" in
          *..*|*" "*|*"	"*) fail_closed "unsafe unified cgroup path" ;;
        esac
        printf '%s%s/cgroup.kill\n' "$watchdog_cgroup_root" "$rel"
        return 0
        ;;
    esac
  done <"$watchdog_proc_cgroup"
  fail_closed "unified cgroup-v2 entry missing"
}

ensure_cgroup_kill_file() {
  local kill_file="$1"
  [ -e "$kill_file" ] || fail_closed "$kill_file missing"
  [ -w "$kill_file" ] || fail_closed "$kill_file is not writable"
}

heartbeat_is_fresh() {
  if [ ! -f "$heartbeat" ]; then
    heartbeat_reason="missing"
    return 1
  fi

  local now_s mtime_s
  now_s="$(date +%s)" || {
    heartbeat_reason="date_failed"
    return 1
  }
  case "$now_s" in
    ''|*[!0-9]*)
      heartbeat_reason="date_invalid"
      return 1
      ;;
  esac

  mtime_s="$(stat -c %Y "$heartbeat")" || {
    heartbeat_reason="stat_failed"
    return 1
  }
  case "$mtime_s" in
    ''|*[!0-9]*)
      heartbeat_reason="stat_invalid"
      return 1
      ;;
  esac

  heartbeat_now_ms=$((now_s * 1000))
  heartbeat_mtime_ms=$((mtime_s * 1000))
  heartbeat_age_ms=$((heartbeat_now_ms - heartbeat_mtime_ms))
  if [ "$heartbeat_age_ms" -le "$stale_ms" ]; then
    heartbeat_reason="fresh"
    return 0
  fi
  heartbeat_reason="stale"
  return 1
}

sleep_poll_interval() {
  local seconds millis interval
  seconds=$((poll_ms / 1000))
  millis=$((poll_ms % 1000))
  printf -v interval '%d.%03d' "$seconds" "$millis"
  sleep "$interval"
}

if [ "$record_setsid" -eq 1 ]; then
  record_setsid_descendant
fi

runner=("$@")
if [ "$strace_execve" -eq 1 ]; then
  command -v strace >/dev/null 2>&1 ||
    fail_usage "strace is unavailable for execve inventory probe"
  runner=(strace -ff -e trace=execve -o "$run_dir/execve" -- "${runner[@]}")
fi

if [ "$disable_watchdog" -eq 1 ]; then
  set +e
  "${runner[@]}" &
  runner_pid="$!"
  wait "$runner_pid"
  status="$?"
  set -e
  exit "$status"
fi

kill_file="$(derive_cgroup_kill_file)"
ensure_cgroup_kill_file "$kill_file"

set +e
"${runner[@]}" &
runner_pid="$!"
set -e

while kill -0 "$runner_pid" 2>/dev/null; do
  if heartbeat_is_fresh; then
    sleep_poll_interval
    continue
  fi
  printf '1\n' >"$kill_file" || fail_closed "write failed for $kill_file"
  printf 'watchdog.sh: heartbeat %s now_ms=%s mtime_ms=%s age_ms=%s stale_ms=%s\n' \
    "$heartbeat_reason" \
    "${heartbeat_now_ms:-unknown}" \
    "${heartbeat_mtime_ms:-unknown}" \
    "${heartbeat_age_ms:-unknown}" \
    "$stale_ms" >&2 || true
  exit 124
done

set +e
wait "$runner_pid"
status="$?"
set -e
exit "$status"
