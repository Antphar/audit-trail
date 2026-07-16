"""Torch-free Node sim-server client helpers."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any


def normalize_sim_mode(mode: str) -> str:
    return "battle" if str(mode).lower() in ("battle", "arena") else "race"


def build_sim_query_flags(
    *,
    mode: str,
    map_id: str,
    character: str,
    frames: int,
    solo: bool,
    no_items: bool,
    no_hazards: bool,
) -> list[str]:
    return [
        "headless=1",
        "external=1",
        f"mode={normalize_sim_mode(mode)}",
        f"map={map_id}",
        f"char={character}",
        f"frames={frames}",
        f"solo={1 if solo else 0}",
        f"noItems={1 if no_items else 0}",
        f"noHazards={1 if no_hazards else 0}",
    ]


def build_sim_query_string(
    *,
    mode: str,
    map_id: str,
    character: str,
    frames: int,
    solo: bool,
    no_items: bool,
    no_hazards: bool,
) -> str:
    return "&".join(
        build_sim_query_flags(
            mode=mode,
            map_id=map_id,
            character=character,
            frames=frames,
            solo=solo,
            no_items=no_items,
            no_hazards=no_hazards,
        )
    )


def find_node_executable() -> str:
    node = shutil.which("node")
    if not node:
        raise RuntimeError(
            "Node.js >= 18 is required for --backend node. "
            "Install Node from https://nodejs.org/ and ensure `node` is on PATH."
        )
    return node


class NodeRpcClient:
    def __init__(self, repo_root: Path, query: str, *, timeout: float = 120.0):
        self.repo_root = repo_root.resolve()
        self.query = query
        self.timeout = timeout
        self._proc: subprocess.Popen[str] | None = None
        self._req_id = 0
        self._stderr_handle = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix="sim-server-",
            suffix=".stderr.log",
            delete=False,
        )
        self._stderr_log = Path(self._stderr_handle.name)

    def start(self) -> None:
        if self._proc is not None:
            return
        server_path = self.repo_root / "sim-server.mjs"
        if not server_path.exists():
            raise FileNotFoundError(f"Node sim server not found: {server_path}")
        node = find_node_executable()
        self._proc = subprocess.Popen(
            [node, str(server_path), "--query", self.query],
            cwd=str(self.repo_root),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr_handle,
            text=True,
            bufsize=1,
        )

    def close(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
        except OSError:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        except OSError:
            pass
        try:
            self._stderr_handle.close()
        except OSError:
            pass
        try:
            if self._stderr_log.exists():
                self._stderr_log.unlink()
        except OSError:
            pass

    def _stderr_tail(self) -> str:
        if not self._stderr_log.exists():
            return "(no stderr log)"
        text = self._stderr_log.read_text(encoding="utf-8", errors="replace").strip()
        if not text:
            return "(stderr log empty)"
        lines = text.splitlines()
        return "\n".join(lines[-20:])

    def rpc(self, method: str, params: dict[str, Any] | None = None) -> Any:
        self.start()
        assert self._proc is not None and self._proc.stdin is not None and self._proc.stdout is not None
        self._req_id += 1
        req_id = self._req_id
        payload = {"id": req_id, "method": method, "params": params or {}}
        try:
            self._proc.stdin.write(json.dumps(payload) + "\n")
            self._proc.stdin.flush()
        except BrokenPipeError as exc:
            raise RuntimeError(
                f"Node sim-server exited unexpectedly during {method!r}. "
                f"See stderr log at {self._stderr_log}:\n{self._stderr_tail()}"
            ) from exc

        deadline = time.monotonic() + self.timeout
        while True:
            if time.monotonic() > deadline:
                self.close()
                raise RuntimeError(
                    f"Node sim-server timed out during {method!r} after {self.timeout}s. "
                    f"See stderr log at {self._stderr_log}:\n{self._stderr_tail()}"
                )
            line = self._proc.stdout.readline()
            if not line:
                code = self._proc.poll()
                raise RuntimeError(
                    f"Node sim-server closed stdout during {method!r} (exit={code}). "
                    f"See stderr log at {self._stderr_log}:\n{self._stderr_tail()}"
                )
            line = line.strip()
            if not line:
                continue
            try:
                response = json.loads(line)
            except json.JSONDecodeError:
                continue
            if response.get("id") != req_id:
                continue
            if "error" in response:
                raise RuntimeError(
                    f"Node sim-server error during {method!r}: {response['error']}. "
                    f"See stderr log at {self._stderr_log}:\n{self._stderr_tail()}"
                )
            return response.get("result")


def run_node_headless_eval(repo_root: Path, query: str, params: dict[str, Any]) -> dict[str, Any]:
    client = NodeRpcClient(repo_root, query)
    try:
        client.start()
        client.rpc("ping")
        return dict(client.rpc("headless_eval", params) or {})
    finally:
        client.close()
