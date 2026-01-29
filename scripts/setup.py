import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
VENV_DIR = REPO_ROOT / ".venv"
BACKEND_REQUIREMENTS = REPO_ROOT / "backend" / "requirements.txt"
LINE_WIDTH = 72


def resolve_command_executable(command):
    if not command:
        raise ValueError("Command cannot be empty")
    executable = command[0]
    resolved = shutil.which(executable)
    if resolved:
        return [resolved, *command[1:]]
    if os.name == "nt" and not executable.lower().endswith((".exe", ".cmd", ".bat")):
        for ext in (".cmd", ".exe", ".bat"):
            resolved = shutil.which(f"{executable}{ext}")
            if resolved:
                return [resolved, *command[1:]]
    raise FileNotFoundError(f"Executable not found on PATH: {executable}")


def run_command(command, cwd=None):
    subprocess.check_call(resolve_command_executable(command), cwd=cwd)


def get_venv_python():
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def ensure_virtualenv():
    if VENV_DIR.exists():
        return
    run_command([sys.executable, "-m", "venv", str(VENV_DIR)])


def install_backend_dependencies():
    venv_python = get_venv_python()
    if not venv_python.exists():
        raise RuntimeError("Virtual environment python not found")
    run_command([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"])
    run_command([str(venv_python), "-m", "pip", "install", "-r", str(BACKEND_REQUIREMENTS)])


def install_frontend_dependencies():
    run_command(["npm", "install"], cwd=str(REPO_ROOT))


def print_header(title):
    line = "=" * LINE_WIDTH
    print(f"\n{line}\n{title.center(LINE_WIDTH)}\n{line}")


def print_step(step_number, total_steps, title, details=None):
    label = f"[{step_number}/{total_steps}] {title}"
    print(f"\n{label}")
    if details:
        for detail in details:
            print(f"  - {detail}")


def main():
    print_header("BearAI Setup")
    print(
        "This script prepares the backend and frontend dependencies.\n"
        "It will create a local Python virtual environment and install\n"
        "the required packages for both services."
    )
    total_steps = 3

    print_step(
        1,
        total_steps,
        "Create or reuse virtual environment",
        [f"Location: {VENV_DIR}"],
    )
    ensure_virtualenv()

    print_step(
        2,
        total_steps,
        "Install backend dependencies",
        [f"Requirements: {BACKEND_REQUIREMENTS}"],
    )
    install_backend_dependencies()

    print_step(3, total_steps, "Install frontend dependencies", ["Command: npm install"])
    install_frontend_dependencies()
    print("\nSetup complete. You can now start the app.")


if __name__ == "__main__":
    main()
