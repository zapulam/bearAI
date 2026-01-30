#!/usr/bin/env bash
set -euo pipefail

LINE_WIDTH=72

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "${script_dir}/.." && pwd -P)"
venv_dir="${repo_root}/.venv"
backend_requirements="${repo_root}/backend/requirements.txt"

print_line() {
  printf '%*s\n' "${LINE_WIDTH}" '' | tr ' ' '='
}

print_header() {
  local title="$1"
  print_line
  printf '%*s\n' $(( (LINE_WIDTH + ${#title}) / 2 )) "${title}"
  print_line
}

progress_bar() {
  local current="$1"
  local total="$2"
  local width=20
  local filled=$(( current * width / total ))
  local empty=$(( width - filled ))
  local filled_bar
  local empty_bar
  filled_bar="$(printf '%*s' "${filled}" '' | tr ' ' '#')"
  empty_bar="$(printf '%*s' "${empty}" '')"
  printf '[%s%s] %s/%s' "${filled_bar}" "${empty_bar}" "${current}" "${total}"
}

print_step() {
  local step_number="$1"
  local total_steps="$2"
  local title="$3"
  shift 3
  printf '\n%s %s\n' "$(progress_bar "${step_number}" "${total_steps}")" "${title}"
  for detail in "$@"; do
    printf '  - %s\n' "${detail}"
  done
}

resolve_python() {
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return
  fi
  if command -v python >/dev/null 2>&1; then
    echo "python"
    return
  fi
  echo "Python not found on PATH." >&2
  exit 1
}

ensure_virtualenv() {
  if [ -d "${venv_dir}" ]; then
    return
  fi
  local python_exec
  python_exec="$(resolve_python)"
  "${python_exec}" -m venv "${venv_dir}"
}

install_backend_dependencies() {
  local venv_python="${venv_dir}/bin/python"
  if [ ! -x "${venv_python}" ]; then
    echo "Virtual environment python not found." >&2
    exit 1
  fi
  "${venv_python}" -m pip install --upgrade pip
  "${venv_python}" -m pip install -r "${backend_requirements}"
}

install_frontend_dependencies() {
  (cd "${repo_root}" && npm install)
}

main() {
  print_header "BearAI Setup"
  printf '%s\n' "This script prepares the backend and frontend dependencies."
  printf '%s\n' "It will create a local Python virtual environment and install"
  printf '%s\n' "the required packages for both services."

  local total_steps=3

  print_step 1 "${total_steps}" "Create or reuse virtual environment" \
    "Location: ${venv_dir}"
  ensure_virtualenv

  print_step 2 "${total_steps}" "Install backend dependencies" \
    "Requirements: ${backend_requirements}"
  install_backend_dependencies

  print_step 3 "${total_steps}" "Install frontend dependencies" \
    "Command: npm install"
  install_frontend_dependencies

  printf '\n%s\n' "Setup complete. You can now start the app."
}

main "$@"
