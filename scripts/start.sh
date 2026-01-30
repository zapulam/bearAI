#!/usr/bin/env bash
set -euo pipefail
set -m

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "${script_dir}/.." && pwd -P)"
backend_dir="${repo_root}/backend"
venv_dir="${repo_root}/.venv"

die() { echo "ERROR: $*" >&2; exit 1; }

is_wsl() { grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; }

ensure_linux_node() {
  command -v node >/dev/null 2>&1 || die "node not found in WSL."
  local node_path
  node_path="$(command -v node)"
  if [[ "${node_path}" == /mnt/* ]]; then
    die "Detected Windows node on PATH inside WSL: ${node_path}
Fix: install Node via nvm inside WSL and/or disable Windows PATH injection in /etc/wsl.conf:
  [interop]
  appendWindowsPath=false
Then run in PowerShell: wsl --shutdown"
  fi
  if [[ "$(node -p 'process.platform' 2>/dev/null || true)" != "linux" ]]; then
    die "node is not reporting linux platform. You are not using Linux node in WSL."
  fi
}

ensure_frontend_deps() {
  # Ensure vite exists locally (prevents the 'vite not recognized' error)
  if [ ! -x "${repo_root}/node_modules/.bin/vite" ]; then
    die "Frontend dependencies missing. Run: (in WSL) npm install (or npm ci) from ${repo_root}"
  fi
}

venv_python="${venv_dir}/bin/python"
if [ ! -x "${venv_python}" ]; then
  die "Virtual environment not found. Run scripts/setup.sh first."
fi

if ! is_wsl; then
  die "This script is intended to be run inside WSL."
fi

stopping=0
backend_pid=""
frontend_pid=""

stop_process() {
  local pid="$1"
  [ -z "${pid}" ] && return
  kill -0 "${pid}" 2>/dev/null || return

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
  [ "${stopping}" -eq 1 ] && return
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
  [ -z "${pids}" ] && return 0

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
(
  cd "${backend_dir}"
  "${venv_python}" -m uvicorn main:app --reload --port 5000
) &
backend_pid=$!

# Frontend: refuse to run if node is not Linux, and ensure deps exist.
ensure_linux_node
ensure_frontend_deps

echo "Starting frontend..."
(
  cd "${repo_root}"
  # Make local binaries (vite) resolvable
  export PATH="${repo_root}/node_modules/.bin:${PATH}"
  # Run via node to avoid accidentally calling Windows npm.cmd
  node ./node_modules/vite/bin/vite.js
) &
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
  [ "${stopping}" -eq 1 ] && break
  sleep 0.2
done
