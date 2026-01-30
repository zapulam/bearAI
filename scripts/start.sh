#!/usr/bin/env bash
set -euo pipefail
set -m

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "${script_dir}/.." && pwd -P)"
backend_dir="${repo_root}/backend"
venv_dir="${repo_root}/.venv"

venv_python="${venv_dir}/bin/python"
if [ ! -x "${venv_python}" ]; then
  echo "Virtual environment not found. Run scripts/setup.sh first." >&2
  exit 1
fi

stopping=0
backend_pid=""
frontend_pid=""

stop_process() {
  local pid="$1"
  if [ -z "${pid}" ]; then
    return
  fi
  if ! kill -0 "${pid}" 2>/dev/null; then
    return
  fi

  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
  local deadline=$((SECONDS + 5))
  while kill -0 "${pid}" 2>/dev/null && [ "${SECONDS}" -lt "${deadline}" ]; do
    sleep 0.2
  done

  if kill -0 "${pid}" 2>/dev/null; then
    kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "${pid}" 2>/dev/null || true
  fi

  wait "${pid}" 2>/dev/null || true
}

request_shutdown() {
  if [ "${stopping}" -eq 1 ]; then
    return
  fi
  stopping=1
  echo "Stopping processes..."
  stop_process "${frontend_pid}"
  stop_process "${backend_pid}"
}

trap 'request_shutdown' INT TERM

find_port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${port}" 2>/dev/null || true
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' || true
    return 0
  fi
  return 1
}

ensure_port_free() {
  local port="$1"
  local pids
  pids="$(find_port_pids "${port}" || true)"
  if [ -z "${pids}" ]; then
    return 0
  fi

  echo "Port ${port} is in use. Stopping existing process(es)..."
  for pid in ${pids}; do
    kill -TERM "${pid}" 2>/dev/null || true
  done

  local deadline=$((SECONDS + 5))
  for pid in ${pids}; do
    while kill -0 "${pid}" 2>/dev/null && [ "${SECONDS}" -lt "${deadline}" ]; do
      sleep 0.2
    done
    if kill -0 "${pid}" 2>/dev/null; then
      kill -KILL "${pid}" 2>/dev/null || true
    fi
  done
}

ensure_port_free 5000

echo "Starting backend..."
(cd "${backend_dir}" && "${venv_python}" -m uvicorn main:app --reload --port 5000) &
backend_pid=$!

echo "Starting frontend..."
(cd "${repo_root}" && npm run dev) &
frontend_pid=$!

while true; do
  if ! kill -0 "${backend_pid}" 2>/dev/null; then
    request_shutdown
    break
  fi
  if ! kill -0 "${frontend_pid}" 2>/dev/null; then
    request_shutdown
    break
  fi
  if [ "${stopping}" -eq 1 ]; then
    break
  fi
  sleep 0.2
done
