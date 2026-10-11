from __future__ import annotations

from typing import Iterable

import numpy as np

Basis = str
PairRDM = tuple[tuple[int, int], np.ndarray]


def compute_k_matrix(
    num_qubits: int,
    rdms: Iterable[PairRDM],
    basis: Basis = "z",
) -> list[list[float | None]]:
    """Compute matrix[i][j] = K_{i->j} from pairwise 2-qubit RDMs.

    Each RDM for qubits (a, b) must use computational basis order
    |a b> = |00>, |01>, |10>, |11>.
    """
    if num_qubits < 1:
        raise ValueError("num_qubits must be at least 1")
    if basis not in {"x", "y", "z"}:
        raise ValueError("basis must be one of: x, y, z")

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

        rho = _sanitize_density_matrix(raw_rho)
        k_ab, k_ba = _compute_pair_values(rho, basis)
        matrix[a][b] = k_ab
        matrix[b][a] = k_ba

    return matrix


def _validate_pair(num_qubits: int, a: int, b: int) -> None:
    if a == b:
        raise ValueError("RDM qubits must be distinct")
    if a < 0 or b < 0 or a >= num_qubits or b >= num_qubits:
        raise ValueError("RDM qubits must be valid indices for num_qubits")


def _compute_pair_values(rho_2q: np.ndarray,
                         basis: Basis) -> tuple[float, float]:
    rotation = _basis_rotation(basis)
    eye = np.eye(2, dtype=complex)

    # RDM basis order is |a b>. For K_{a->b}, rotate/measure the first qubit.
    rotate_first = np.kron(rotation, eye)
    rho_first = rotate_first @ rho_2q @ rotate_first.conj().T
    k_ab = _compute_directional_k(rho_first, [0, 1], [2, 3])

    # For K_{b->a}, rotate/measure the second qubit.
    rotate_second = np.kron(eye, rotation)
    rho_second = rotate_second @ rho_2q @ rotate_second.conj().T
    k_ba = _compute_directional_k(rho_second, [0, 2], [1, 3])

    return k_ab, k_ba


def _compute_directional_k(
    rho_2q: np.ndarray,
    outcome_0_indices: list[int],
    outcome_1_indices: list[int],
    tol: float = 1e-10,
) -> float:
    sigma_0 = rho_2q[np.ix_(outcome_0_indices, outcome_0_indices)]
    sigma_1 = rho_2q[np.ix_(outcome_1_indices, outcome_1_indices)]

    p0 = float(np.real(np.trace(sigma_0)))
    p1 = float(np.real(np.trace(sigma_1)))
    if p0 < tol or p1 < tol:
        return 0.0

    rho_0 = sigma_0 / p0
    rho_1 = sigma_1 / p1
    fidelity = _two_by_two_squared_fidelity(rho_0, rho_1)
    value = 4.0 * p0 * p1 * (1.0 - fidelity)
    return float(np.clip(np.real(value), 0.0, 1.0))


def _two_by_two_squared_fidelity(rho: np.ndarray, sigma: np.ndarray) -> float:
    trace_product = np.real(np.trace(rho @ sigma))
    det_rho = np.real(np.linalg.det(rho))
    det_sigma = np.real(np.linalg.det(sigma))
    fidelity = trace_product + 2.0 * np.sqrt(
        max(det_rho, 0.0) * max(det_sigma, 0.0))
    return float(np.clip(fidelity, 0.0, 1.0))


def _basis_rotation(basis: Basis) -> np.ndarray:
    if basis == "x":
        return np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2)
    if basis == "y":
        h = np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2)
        s_dagger = np.array([[1, 0], [0, -1j]], dtype=complex)
        return h @ s_dagger
    return np.eye(2, dtype=complex)


def _sanitize_density_matrix(rho: np.ndarray,
                             tol: float = 1e-12) -> np.ndarray:
    matrix = np.asarray(rho, dtype=complex)
    if matrix.shape != (4, 4):
        raise ValueError("each RDM rho must be a 4x4 matrix")

    matrix = 0.5 * (matrix + matrix.conj().T)
    trace = np.trace(matrix)
    if abs(trace) < tol:
        raise ValueError("each RDM rho must have nonzero trace")
    if abs(trace - 1.0) > tol:
        matrix = matrix / trace
    return matrix
