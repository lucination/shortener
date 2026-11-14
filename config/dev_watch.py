#!/usr/bin/env python3
"""Task-local supervised Rust rebuild/restart loop. Never used in production images."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--port", type=int, default=3001)
    parser.add_argument("--lock", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    env_path = Path(args.env).resolve()
    running = True
    processes = set()
    server = None

    def log(event, **fields):
        print(json.dumps({"event": event, **fields}), flush=True)

    def terminate(process):
        if process is None or process.poll() is not None:
            return
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=12)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=3)

    def stop(_sig, _frame):
        nonlocal running
        running = False
        for process in tuple(processes):
            terminate(process)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def fingerprint():
        files = [root / "Cargo.toml", root / "Cargo.lock", env_path]
        for directory, patterns in [("src", ("*.rs",)), ("migration", ("*.sql",)), ("config", ("*.yaml", "*.yml"))]:
            for pattern in patterns:
                files.extend(sorted((root / directory).rglob(pattern)))
        digest = hashlib.sha256()
        for file in files:
            digest.update(str(file).encode())
            try:
                digest.update(file.read_bytes())
            except FileNotFoundError:
                digest.update(b"missing")
        return digest.hexdigest()

    def environment():
        env = dict(os.environ)
        for line in env_path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip()
        env["CARGO_TARGET_DIR"] = args.target
        env["CARGO_BUILD_JOBS"] = "1"
        env["PATH"] = str(Path.home() / ".cargo/bin") + ":" + env.get("PATH", "")
        return env

    def rebuild():
        nonlocal server
        env = environment()
        log("build-start")
        with open(args.lock, "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if not running:
                return
            build = subprocess.Popen([str(Path.home() / ".cargo/bin/cargo"), "build", "--locked", "--bin", "shortener", "-j", "1"], cwd=root, env=env, start_new_session=True)
            processes.add(build)
            code = build.wait()
            processes.discard(build)
        if code != 0 or not running:
            log("build-failed", code=code, previous_server_kept=server is not None and server.poll() is None)
            return
        log("build-ok")
        terminate(server)
        processes.discard(server)
        server = subprocess.Popen([str(Path(args.target) / "debug/shortener"), "start", "--binding", "127.0.0.1", "--port", str(args.port), "--no-banner"], cwd=root, env=env, start_new_session=True)
        processes.add(server)
        for _ in range(100):
            if not running or server.poll() is not None:
                log("server-start-failed", code=server.poll())
                return
            try:
                if urllib.request.urlopen(f"http://127.0.0.1:{args.port}/_health", timeout=0.5).status == 200:
                    log("server-ready", pid=server.pid, port=args.port)
                    return
            except OSError:
                pass
            time.sleep(0.1)
        log("server-readiness-timeout", pid=server.pid)
        terminate(server)

    last = None
    try:
        while running:
            current = fingerprint()
            if current != last:
                time.sleep(0.6)
                stable = fingerprint()
                if stable != current:
                    continue
                last = stable
                rebuild()
            time.sleep(0.3)
    finally:
        for process in tuple(processes):
            terminate(process)
        log("watcher-stopped")


if __name__ == "__main__":
    main()
