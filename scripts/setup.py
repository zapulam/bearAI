#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys
from pathlib import Path


LINE_WIDTH = 72

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
VENV_DIR = REPO_ROOT / ".venv"
BACKEND_REQUIREMENTS = REPO_ROOT / "backend" / "requirements.txt"


def print_line() -> None:
    print("=" * LINE_WIDTH)


def print_header(title: str) -> None:
    print_line()
    padding = (LINE_WIDTH + len(title)) // 2
    print(f"{title:>{padding}}")
    print_line()


def progress_bar(current: int, total: int) -> str:
    width = 20
    filled = current * width // total
    empty = width - filled
    return f"[{'#' * filled}{' ' * empty}] {current}/{total}"


def print_step(step_number: int, total_steps: int, title: str, *details: str) -> None:
    print(f"\n{progress_bar(step_number, total_steps)} {title}")
    for detail in details:
        print(f"  - {detail}")


def die(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def resolve_python() -> str:
    if shutil.which("python3"):
        return "python3"
    if shutil.which("python"):
        return "python"
    die("Python not found on PATH.")
    return "python"


def ensure_virtualenv() -> None:
    if VENV_DIR.is_dir():
        return
    python_exec = resolve_python()
    subprocess.run([python_exec, "-m", "venv", str(VENV_DIR)], check=True)


def install_backend_dependencies() -> None:
    venv_python = VENV_DIR / "bin" / "python"
    if not venv_python.exists():
        die(f"Virtual environment python not found at {venv_python}")
    subprocess.run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    subprocess.run(
        [str(venv_python), "-m", "pip", "install", "-r", str(BACKEND_REQUIREMENTS)],
        check=True,
    )


def ensure_node_npm() -> None:
    if not shutil.which("node"):
        die("node not found on PATH.")
    if not shutil.which("npm"):
        die("npm not found on PATH.")


def ensure_nvm_lts_node() -> None:
    if not shutil.which("nvm"):
        if shutil.which("curl"):
            subprocess.run(
                "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash",
                shell=True,
                check=True,
            )
        elif shutil.which("wget"):
            subprocess.run(
                "wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash",
                shell=True,
                check=True,
            )
        else:
            die("Neither curl nor wget found; cannot install nvm automatically.")

    nvm_dir = os.environ.get("NVM_DIR", str(Path.home() / ".nvm"))
    command = (
        f'export NVM_DIR="{nvm_dir}"; '
        '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; '
        "command -v nvm >/dev/null 2>&1 && nvm install --lts >/dev/null && nvm use --lts >/dev/null"
    )
    subprocess.run(["bash", "-lc", command], check=True)


def install_frontend_dependencies() -> None:
    if (REPO_ROOT / "package-lock.json").exists():
        subprocess.run(["npm", "ci"], check=True, cwd=str(REPO_ROOT))
    else:
        subprocess.run(["npm", "install"], check=True, cwd=str(REPO_ROOT))


def get_command_output(command: list[str]) -> str:
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        return result.stdout.strip() or "unknown"
    except (subprocess.SubprocessError, FileNotFoundError):
        return "unknown"


def main() -> None:
    print_header("BearAI Setup")
    print("This script prepares the backend and frontend dependencies.")
    print("It will create a local Python virtual environment and install")
    print("the required packages for both services.")

    total_steps = 5

    print_step(1, total_steps, "Create or reuse virtual environment", f"Location: {VENV_DIR}")
    ensure_virtualenv()

    print_step(
        2,
        total_steps,
        "Install backend dependencies",
        f"Requirements: {BACKEND_REQUIREMENTS}",
    )
    install_backend_dependencies()

    print_step(3, total_steps, "Ensure node/npm are installed", "Validates node/npm on PATH")
    ensure_nvm_lts_node()
    ensure_node_npm()

    print_step(
        4,
        total_steps,
        "Install frontend dependencies",
        "Command: npm ci (if lockfile) else npm install",
    )
    install_frontend_dependencies()

    print_step(
        5,
        total_steps,
        "Summary",
        f"Python venv: {VENV_DIR}",
        f"Node: {get_command_output(['node', '-v'])}",
        f"npm: {get_command_output(['npm', '-v'])}",
    )

    print("\nSetup complete. You can now start the app.")


if __name__ == "__main__":
    main()
