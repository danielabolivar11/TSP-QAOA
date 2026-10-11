import os
import subprocess
from pathlib import Path

_INTERFACE_PORT_BY_BRANCH = {
    "main": 8001,      # production interface
    "staging": 8003,   # staging interface
}

def _branch() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=Path(__file__).resolve().parent,
        text=True,
    ).strip()

def _interface_url() -> str:
    override = os.environ.get("INTERFACE_URL")
    if override:
        return override
    branch = _branch()
    try:
        port = _INTERFACE_PORT_BY_BRANCH[branch]
    except KeyError:
        raise RuntimeError(
            f"no interface port mapped for branch {branch!r}; "
            f"known: {list(_INTERFACE_PORT_BY_BRANCH)}"
        )
    return f"http://127.0.0.1:{port}"

INTERFACE_URL = _interface_url()
