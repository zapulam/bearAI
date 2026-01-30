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
  local filled_bar empty_bar
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

die() {
  echo "ERROR: $*" >&2
  exit 1
}

is_wsl() {
  grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null
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
  die "Python not found on PATH."
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
    die "Virtual environment python not found at ${venv_python}"
  fi
  "${venv_python}" -m pip install --upgrade pip
  "${venv_python}" -m pip install -r "${backend_requirements}"
}

warn_if_windows_filesystem() {
  # WSL works best when the repo is in the Linux filesystem (e.g., /home/...)
  # Node installs are especially prone to issues on /mnt/c.
  if [[ "${repo_root}" == /mnt/* ]]; then
    echo "WARNING: Repo is under ${repo_root}"
    echo "         Running node/npm on /mnt/* is slower and can cause permission/lock issues."
    echo "         Recommended: move the repo to ~/ (Linux filesystem), e.g. ~/bearAI"
  fi
}

ensure_linux_node_npm() {
  command -v node >/dev/null 2>&1 || die "node not found in WSL. Install with nvm (recommended) or apt."
  command -v npm  >/dev/null 2>&1 || die "npm not found in WSL. Install with nvm (recommended) or apt."

  local node_path npm_path
  node_path="$(command -v node)"
  npm_path="$(command -v npm)"

  # If Windows PATH has leaked into WSL, these often point into /mnt/c/...
  if [[ "${node_path}" == /mnt/* ]] || [[ "${npm_path}" == /mnt/* ]]; then
    die "Detected Windows node/npm on PATH inside WSL:
  node: ${node_path}
  npm : ${npm_path}

Fix: install node via nvm inside WSL and/or disable Windows PATH injection in /etc/wsl.conf:
  [interop]
  appendWindowsPath=false
Then run in PowerShell: wsl --shutdown"
  fi

  # Extra sanity: ensure node reports linux platform
  if [[ "$(node -p 'process.platform' 2>/dev/null || true)" != "linux" ]]; then
    die "node is not reporting linux platform. You are not using Linux node in WSL."
  fi
}

ensure_nvm_lts_node() {
  # Optional convenience: install nvm + LTS node if nvm exists or can be installed.
  # You can comment this out if you want the script to only validate.
  if ! command -v nvm >/dev/null 2>&1; then
    # Install nvm
    if command -v curl >/dev/null 2>&1; then
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    elif command -v wget >/dev/null 2>&1; then
      wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    else
      die "Neither curl nor wget found; cannot install nvm automatically."
    fi
  fi

  # Load nvm into this shell (installer adds to ~/.bashrc; this makes script-run work too)
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1090
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

  if command -v nvm >/dev/null 2>&1; then
    nvm install --lts >/dev/null
    nvm use --lts >/dev/null
  fi
}

install_frontend_dependencies() {
  # Run npm in repo root, forcing Linux environment, and prefer CI-like deterministic installs if lock exists.
  (
    cd "${repo_root}"

    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
  )
}

main() {
  print_header "BearAI Setup"
  printf '%s\n' "This script prepares the backend and frontend dependencies."
  printf '%s\n' "It will create a local Python virtual environment and install"
  printf '%s\n' "the required packages for both services."

  if ! is_wsl; then
    die "This script is intended to be run inside WSL."
  fi

  warn_if_windows_filesystem

  local total_steps=5

  print_step 1 "${total_steps}" "Create or reuse virtual environment" \
    "Location: ${venv_dir}"
  ensure_virtualenv

  print_step 2 "${total_steps}" "Install backend dependencies" \
    "Requirements: ${backend_requirements}"
  install_backend_dependencies

  print_step 3 "${total_steps}" "Ensure Linux node/npm (not Windows)" \
    "Validates node/npm are Linux binaries in WSL"
  # Optional: uncomment next line if you want script to auto-install LTS via nvm
  ensure_nvm_lts_node
  ensure_linux_node_npm

  print_step 4 "${total_steps}" "Install frontend dependencies" \
    "Command: npm ci (if lockfile) else npm install"
  install_frontend_dependencies

  print_step 5 "${total_steps}" "Summary" \
    "Python venv: ${venv_dir}" \
    "Node: $(node -v 2>/dev/null || echo 'unknown')" \
    "npm: $(npm -v 2>/dev/null || echo 'unknown')"

  printf '\n%s\n' "Setup complete. You can now start the app."
}

main "$@"
