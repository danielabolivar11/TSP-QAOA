from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Literal

import numpy as np

from qcflows_api.k_measure import (
    PairRDM,
    _sanitize_density_matrix,
    _validate_pair,
    compute_k_matrix,
)

Metric = Literal["k", "eof", "mi"]


def compute_metric_matrix(
    num_qubits: int,
    rdms: Iterable[PairRDM],
    metric: Metric = "k",
    basis: str = "z",
) -> list[list[float | None]]:
    if metric == "k":
        return compute_k_matrix(num_qubits, rdms, basis=basis)
    if metric == "eof":
        return _compute_symmetric_metric_matrix(
            num_qubits, rdms, _entanglement_of_formation)
    if metric == "mi":
        return _compute_symmetric_metric_matrix(
            num_qubits, rdms, _mutual_information)
    raise ValueError("metric must be one of: k, eof, mi")


def metric_label(metric: Metric, basis: str = "z") -> str:
    if metric == "k":
        return f"K_{basis.upper()}"
    if metric == "eof":
        return "EoF"
    if metric == "mi":
        return "MI"
    raise ValueError("metric must be one of: k, eof, mi")


def metric_max(metric: Metric) -> float:
    if metric == "mi":
        return 2.0
    if metric in {"k", "eof"}:
        return 1.0
    raise ValueError("metric must be one of: k, eof, mi")


def _compute_symmetric_metric_matrix(
    num_qubits: int,
    rdms: Iterable[PairRDM],
    pair_metric: Callable[[np.ndarray], float],
) -> list[list[float | None]]:
    if num_qubits < 1:
        raise ValueError("num_qubits must be at least 1")

    matrix: list[list[float | None]] = [[
        0.0 if row == col else None for col in range(num_qubits)
    ] for row in range(num_qubits)]
    seen_pairs: set[frozenset[int]] = set()

    for qubits, raw_rho in rdms:
        a, b = qubits
        _validate_pair(num_qubits, a, b)
        pair_key = frozenset((a, b))
        if pair_key in seen_pairs:
            raise ValueError(
                f"duplicate RDM for qubit pair {sorted(pair_key)}")
        seen_pairs.add(pair_key)

        value = pair_metric(_sanitize_density_matrix(raw_rho))
        matrix[a][b] = value
        matrix[b][a] = value

    return matrix


def _entanglement_of_formation(rho_2q: np.ndarray) -> float:
    concurrence = _concurrence(rho_2q)
    if concurrence <= 0.0:
        return 0.0

    entropy_argument = (
        1.0 + np.sqrt(max(0.0, 1.0 - concurrence * concurrence))
    ) / 2.0
    return _binary_entropy(entropy_argument)


def _concurrence(rho_2q: np.ndarray) -> float:
    sigma_y = np.array([[0, -1j], [1j, 0]], dtype=complex)
    spin_flip = np.kron(sigma_y, sigma_y)
    rho_tilde = spin_flip @ rho_2q.conj() @ spin_flip
    eigenvalues = np.linalg.eigvals(rho_2q @ rho_tilde)
    roots = sorted(
        (np.sqrt(max(float(np.real(value)), 0.0)) for value in eigenvalues),
        reverse=True,
    )
    concurrence = roots[0] - sum(roots[1:])
    return float(np.clip(concurrence, 0.0, 1.0))


def _mutual_information(rho_2q: np.ndarray) -> float:
    rho_a, rho_b = _partial_traces(rho_2q)
    value = (
        _von_neumann_entropy(rho_a)
        + _von_neumann_entropy(rho_b)
        - _von_neumann_entropy(rho_2q)
    )
    return float(max(value, 0.0))


def _partial_traces(rho_2q: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    tensor = rho_2q.reshape(2, 2, 2, 2)
    rho_a = np.trace(tensor, axis1=1, axis2=3)
    rho_b = np.trace(tensor, axis1=0, axis2=2)
    return rho_a, rho_b


def _von_neumann_entropy(rho: np.ndarray) -> float:
    eigenvalues = np.linalg.eigvalsh(0.5 * (rho + rho.conj().T))
    probabilities = np.clip(np.real(eigenvalues), 0.0, 1.0)
    probabilities = probabilities[probabilities > 1e-12]
    if probabilities.size == 0:
        return 0.0
    return float(-np.sum(probabilities * np.log2(probabilities)))


def _binary_entropy(probability: float) -> float:
    probability = float(np.clip(probability, 0.0, 1.0))
    if probability <= 1e-12 or probability >= 1.0 - 1e-12:
        return 0.0
    complement = 1.0 - probability
    return float(
        -probability * np.log2(probability)
        - complement * np.log2(complement)
    )
