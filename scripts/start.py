#!/usr/bin/env python3
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
BACKEND_DIR = REPO_ROOT / "backend"
VENV_DIR = REPO_ROOT / ".venv"

stopping = False
backend_proc: subprocess.Popen[str] | None = None
frontend_proc: subprocess.Popen[str] | None = None


def die(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def ensure_node() -> None:
    if not shutil.which("node"):
        die("node not found on PATH.")


def ensure_frontend_deps() -> None:
    vite_path = REPO_ROOT / "node_modules" / ".bin" / "vite"
    if not vite_path.exists():
        die(f"Frontend dependencies missing. Run: npm install (or npm ci) from {REPO_ROOT}")


def find_port_pids(port: int) -> list[int]:
    if shutil.which("lsof"):
        result = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}"], capture_output=True, text=True
        )
        return [int(pid) for pid in result.stdout.split() if pid.isdigit()]
    if shutil.which("fuser"):
        result = subprocess.run(
            ["fuser", f"{port}/tcp"], capture_output=True, text=True
        )
        return [int(pid) for pid in result.stdout.split() if pid.isdigit()]
    return []


def ensure_port_free(port: int) -> None:
    pids = find_port_pids(port)
    if not pids:
        return

    print(f"Port {port} is in use. Stopping existing process(es)...")
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    deadline = time.time() + 5
    for pid in pids:
        while time.time() < deadline:
            try:
                os.kill(pid, 0)
                time.sleep(0.2)
            except ProcessLookupError:
                break
        try:
            os.kill(pid, 0)
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def stop_process(proc: subprocess.Popen[str] | None) -> None:
    if proc is None:
        return
    if proc.poll() is not None:
        return

    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except PermissionError:
        try:
            proc.terminate()
        except ProcessLookupError:
            return

    deadline = time.time() + 5
    while time.time() < deadline and proc.poll() is None:
        time.sleep(0.2)

    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass

    try:
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass


def request_shutdown(_signum: int | None = None, _frame: object | None = None) -> None:
    global stopping
    if stopping:
        return
    stopping = True
    print("Stopping processes...")
    stop_process(frontend_proc)
    stop_process(backend_proc)


def main() -> None:
    venv_python = VENV_DIR / "bin" / "python"
    if not venv_python.exists():
        die("Virtual environment not found. Run scripts/setup.py first.")

    ensure_port_free(5000)

    print("Starting backend...")
    global backend_proc
    backend_proc = subprocess.Popen(
        [str(venv_python), "-m", "uvicorn", "main:app", "--reload", "--port", "5000"],
        cwd=str(BACKEND_DIR),
        start_new_session=True,
    )

    ensure_node()
    ensure_frontend_deps()

    print("Starting frontend...")
    global frontend_proc
    env = os.environ.copy()
    env["PATH"] = f"{REPO_ROOT / 'node_modules' / '.bin'}:{env.get('PATH', '')}"
    frontend_proc = subprocess.Popen(
        ["node", str(REPO_ROOT / "node_modules" / "vite" / "bin" / "vite.js")],
        cwd=str(REPO_ROOT),
        env=env,
        start_new_session=True,
    )

    while True:
        if backend_proc.poll() is not None:
            request_shutdown()
            break
        if frontend_proc.poll() is not None:
            request_shutdown()
            break
        if stopping:
            break
        time.sleep(0.2)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)
    main()
