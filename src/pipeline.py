import os

import httpx
import numpy as np

from qcflows_api.k_measure import _basis_rotation
from qcflows_api.pair_metrics import compute_metric_matrix, metric_label, metric_max, Metric
from qcflows_api.branch_redirect import INTERFACE_URL


_BASIS_LABELS = {
    "z": ("0", "1"),
    "x": ("+", "-"),
    "y": ("i", "ī"),
}

def _to_complex(rho: list) -> np.ndarray:
    return np.array([[complex(c[0], c[1]) for c in row] for row in rho], dtype=complex)


def _prob0(rho1: np.ndarray, basis: str) -> float:
    r = _basis_rotation(basis)
    rot = r @ rho1 @ r.conj().T
    return float(np.clip(rot[0, 0].real, 0.0, 1.0))


def _edges(matrix: list) -> list:
    edges, n = [], len(matrix)
    for s in range(n):
        for t in range(s + 1, n):
            fwd = float(matrix[s][t] or 0.0)
            rev = float(matrix[t][s] or 0.0)
            val = max(fwd, rev)
            if val <= 1e-9:
                continue
            edges.append({
                "source": s if fwd >= rev else t,
                "target": t if fwd >= rev else s,
                "value": val,
                "directed": abs(fwd - rev) > 1e-9,
            })
    return edges

def _state_amplitudes(statevector, basis, n):
    vec = np.array([complex(c[0], c[1]) for c in statevector], dtype=complex)
    if basis in ("x", "y"):
        u = _basis_rotation(basis)
        full = u
        for _ in range(n - 1):
            full = np.kron(full, u)     # U^{⊗N}; uniform U so kron order is irrelevant
        vec = full @ vec
    l0, l1 = _BASIS_LABELS.get(basis, ("0", "1"))
    return [
        {
            "basis_state": "|" + "".join(
                l1 if (i >> bit) & 1 else l0
                for bit in range(n - 1, -1, -1)
            ) + ">",
            "amplitude": [float(amp.real), float(amp.imag)],
            "magnitude_squared": float(abs(amp) ** 2),
        }
        for i, amp in enumerate(vec)
    ]


def _build_results(raw_results, num_qubits, basis, metric: Metric="k"):

    results = []
    for entry in raw_results:
        rdms = [(tuple(r["qubits"]), _to_complex(r["rho"])) for r in entry["rdms"]]
        matrix = compute_metric_matrix(num_qubits, rdms, metric=metric, basis=basis)
        nodes = sorted(
            ({"id": m["qubit"], "prob0": _prob0(_to_complex(m["rho"]), basis)}
             for m in entry["marginals"]),
            key=lambda x: x["id"],
        )
        results.append({
            "marker": entry["marker"],
            "basis": basis,
            "metric": metric,
            "metric_label": metric_label(metric, basis),
            "metric_max": metric_max(metric),
            "num_qubits": num_qubits,
            "nodes": nodes,
            "edges": _edges(matrix),
            "matrix": matrix,
            "amplitudes": _state_amplitudes(entry["statevector"], basis, num_qubits)
        })
    return results

def _fetch_raw(num_qubits, operations, markers):
    payload = {"num_qubits": num_qubits, "operations": operations}
    if markers is not None:
        payload["markers"] = markers
    resp = httpx.post(f"{INTERFACE_URL}/rdms", json=payload, timeout=120)
    resp.raise_for_status()
    return resp.json()["results"]


def compute_markers(num_qubits, operations, basis, markers=None, metric: Metric ='k'):
    raw = _fetch_raw(num_qubits, operations, markers)
    return _build_results(raw, num_qubits, basis, metric)

def compute_markers_all_basis(num_qubits, operations, markers=None):
    raw = _fetch_raw(num_qubits, operations, markers)
    return {
        basis: _build_results(raw, num_qubits, basis)
        for basis in ("z", "x", "y")
    }



def compute_markers_grid(num_qubits, operations, markers=None):
    raw = _fetch_raw(num_qubits, operations, markers)
    return {
        metric: {
            basis: _build_results(raw, num_qubits, basis, metric)
            for basis in ("z", "x", "y")
        }
        for metric in ("k", "eof", "mi")
    }
