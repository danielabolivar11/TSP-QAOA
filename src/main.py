from __future__ import annotations

from typing import Annotated, Any, Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx

from qcflows_api.circuit_model import DEMO_CIRCUIT, CircuitSnapshot
from qcflows_api.experiments import (
    DEFAULT_EXPERIMENT_ID,
    StoredExperiment,
    get_experiment,
    load_experiments,
)
from qcflows_api.pipeline import compute_markers, compute_markers_all_basis, compute_markers_grid
from qcflows_api.demo.routes import router as demo_router
from qcflows_api.qasm import router as qasm_router
from qcflows_api.pair_metrics import (
    Metric,
    compute_metric_matrix,
    metric_label,
    metric_max,
)

app = FastAPI(title="QCFlows API", version="0.1.0")
app.include_router(demo_router)
app.include_router(qasm_router)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class RDMInput(BaseModel):
    qubits: tuple[int, int] = Field(
        description="Qubit pair [a, b]. RDM basis order is |a b> = 00, 01, 10, 11.")
    rho: list[list[Any]] = Field(
        description="4x4 density matrix. Entries may be numbers or [real, imag].")


class PairMatrixRequest(BaseModel):
    num_qubits: int = Field(ge=1)
    basis: Literal["x", "y", "z"] = "z"
    rdms: list[RDMInput]


class KMatrixRequest(PairMatrixRequest):
    pass


class MetricMatrixRequest(PairMatrixRequest):
    metric: Metric = "k"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v0/k-matrix")
def k_matrix(request: KMatrixRequest) -> dict[str, Any]:
    matrix = _compute_request_matrix(request, metric="k")
    return {
        "version": "0.1.0",
        "basis": request.basis,
        "num_qubits": request.num_qubits,
        "matrix": matrix,
    }


@app.post("/v0/metric-matrix")
def metric_matrix(request: MetricMatrixRequest) -> dict[str, Any]:
    matrix = _compute_request_matrix(request, metric=request.metric)
    return {
        "version": "0.1.0",
        "metric": request.metric,
        "metric_label": metric_label(request.metric, request.basis),
        "metric_max": metric_max(request.metric),
        "basis": request.basis,
        "num_qubits": request.num_qubits,
        "matrix": matrix,
    }


def _compute_request_matrix(
    request: PairMatrixRequest,
    metric: Metric,
) -> list[list[float | None]]:
    try:
        rdms = [
            (rdm.qubits, _parse_complex_matrix(rdm.rho))
            for rdm in request.rdms
        ]
        return compute_metric_matrix(
            num_qubits=request.num_qubits,
            rdms=rdms,
            metric=metric,
            basis=request.basis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/timeline")
def timeline() -> dict[str, Any]:
    return DEMO_CIRCUIT.timeline_payload()


@app.get("/get_operations")
def get_operations() -> dict[str, Any]:
    return DEMO_CIRCUIT.operations_payload()


@app.get("/experiments")
def experiments() -> dict[str, Any]:
    return {
        "experiments": [
            experiment.summary_payload()
            for experiment in load_experiments().values()
        ],
    }


@app.get("/experiments/{experiment_id}")
def experiment(
    experiment_id: str,
    marker: Annotated[int | None, Query(ge=0)] = None,
) -> dict[str, Any]:
    return _resolve_experiment(experiment_id).detail_payload(marker)


@app.get("/demo_experiments")
def demo_experiments() -> dict[str, Any]:
    return experiments()


@app.get("/demo_experiments/{experiment_id}")
def demo_experiment(
    experiment_id: str,
    marker: Annotated[int | None, Query(ge=0)] = None,
) -> dict[str, Any]:
    return experiment(experiment_id, marker)


@app.get("/get_state")
def get_state(
    basis: Literal["x", "y", "z"] = "z",
    marker: Annotated[int | None, Query(ge=0)] = None,
) -> dict[str, Any]:
    snapshot = _resolve_demo_snapshot(marker)
    state = _demo_statevector(basis, snapshot)
    return {
        "basis": basis,
        "marker": snapshot.marker,
        "marker_label": snapshot.label,
        "num_qubits": _DEMO_NUM_QUBITS,
        "amplitudes": [
            {
                "basis_state": f"|{index:0{_DEMO_NUM_QUBITS}b}>",
                "amplitude": _complex_pair(amplitude),
                "magnitude_squared": float(np.abs(amplitude) ** 2),
            }
            for index, amplitude in enumerate(state)
        ],
    }


@app.get("/graph_data")
def graph_data(
    basis: Literal["x", "y", "z"] = "z",
    metric: Metric = "k",
    marker: Annotated[int | None, Query(ge=0)] = None,
) -> dict[str, Any]:
    snapshot = _resolve_demo_snapshot(marker)
    matrix = compute_metric_matrix(
        num_qubits=_DEMO_NUM_QUBITS,
        rdms=_demo_rdms(snapshot),
        metric=metric,
        basis=basis,
    )
    return {
        "basis": basis,
        "metric": metric,
        "metric_label": metric_label(metric, basis),
        "metric_max": metric_max(metric),
        "marker": snapshot.marker,
        "marker_label": snapshot.label,
        "num_qubits": _DEMO_NUM_QUBITS,
        "nodes": _demo_nodes(basis, snapshot),
        "edges": _matrix_edges(matrix),
        "matrix": matrix,
    }


@app.get("/get_circuit")
def get_circuit(
    experiment: str = DEFAULT_EXPERIMENT_ID,
    marker: Annotated[int | None, Query(ge=0)] = None,
) -> dict[str, Any]:
    stored_experiment = _resolve_experiment(experiment)
    snapshot = _resolve_demo_snapshot(marker, stored_experiment)
    return stored_experiment.circuit.circuit_payload(snapshot.marker)


def _parse_complex_matrix(raw_matrix: list[list[Any]]) -> np.ndarray:
    if len(raw_matrix) != 4 or any(len(row) != 4 for row in raw_matrix):
        raise ValueError("each RDM rho must be a 4x4 matrix")

    return np.array(
        [[_parse_complex_entry(entry) for entry in row] for row in raw_matrix],
        dtype=complex,
    )


def _parse_complex_entry(value: Any) -> complex:
    if isinstance(value, bool):
        raise ValueError("matrix entries must be numbers or [real, imag]")
    if _is_number(value):
        return complex(float(value), 0.0)
    if (isinstance(value, list) and len(value) == 2
            and all(_is_number(component) for component in value)):
        return complex(float(value[0]), float(value[1]))
    raise ValueError("matrix entries must be numbers or [real, imag]")


def _is_number(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float))


_DEMO_NUM_QUBITS = 2
_DEMO_INPUT_STATE = np.zeros(2**_DEMO_NUM_QUBITS, dtype=complex)
_DEMO_INPUT_STATE[0] = 1.0
_DEMO_H_STATE = np.zeros(2**_DEMO_NUM_QUBITS, dtype=complex)
_DEMO_H_STATE[0] = 1 / np.sqrt(2)
_DEMO_H_STATE[1] = 1 / np.sqrt(2)
_DEMO_BELL_STATE = np.zeros(2**_DEMO_NUM_QUBITS, dtype=complex)
_DEMO_BELL_STATE[0] = 1 / np.sqrt(2)
_DEMO_BELL_STATE[3] = 1 / np.sqrt(2)
_DEMO_STATES = {
    0: _DEMO_INPUT_STATE,
    1: _DEMO_H_STATE,
    2: _DEMO_BELL_STATE,
}
_DEMO_BELL_RDM = np.array([
    [0.5, 0.0, 0.0, 0.5],
    [0.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 0.0],
    [0.5, 0.0, 0.0, 0.5],
], dtype=complex)


def _resolve_experiment(experiment_id: str) -> StoredExperiment:
    stored_experiment = get_experiment(experiment_id)
    if stored_experiment is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown experiment: {experiment_id}",
        )
    return stored_experiment


def _resolve_demo_snapshot(
    marker: int | None,
    experiment: StoredExperiment | None = None,
) -> CircuitSnapshot:
    circuit = experiment.circuit if experiment else DEMO_CIRCUIT
    try:
        return circuit.snapshot(marker)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _demo_statevector(basis: str, snapshot: CircuitSnapshot) -> np.ndarray:
    state = _DEMO_STATES[snapshot.marker].copy()
    if basis == "z":
        return state
    rotation = _basis_display_rotation(basis)
    for qubit in range(_DEMO_NUM_QUBITS):
        state = _apply_single_qubit(state, qubit, rotation)
    return state


def _demo_rdms(snapshot: CircuitSnapshot) -> list[tuple[tuple[int, int], np.ndarray]]:
    if _operation_signature(snapshot) != (("h", (0,)), ("cx", (0, 1))):
        return []
    return [((0, 1), _DEMO_BELL_RDM)]


def _demo_nodes(basis: str, snapshot: CircuitSnapshot) -> list[dict[str, float | int]]:
    state = _demo_statevector(basis, snapshot)
    probabilities = np.abs(state) ** 2
    nodes: list[dict[str, float | int]] = []
    for qubit in range(_DEMO_NUM_QUBITS):
        mask = 1 << qubit
        prob0 = sum(
            float(probability)
            for index, probability in enumerate(probabilities)
            if not index & mask
        )
        nodes.append({"id": qubit, "prob0": prob0})
    return nodes


def _operation_signature(snapshot: CircuitSnapshot) -> tuple[tuple[str, tuple[int, ...]], ...]:
    return tuple(
        (operation.gate, operation.qubits)
        for operation in snapshot.operations
    )


def _matrix_edges(matrix: list[list[float | None]]) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for source in range(len(matrix)):
        for target in range(source + 1, len(matrix)):
            forward = float(matrix[source][target] or 0.0)
            reverse = float(matrix[target][source] or 0.0)
            value = max(forward, reverse)
            if value <= 1e-9:
                continue
            directed = abs(forward - reverse) > 1e-9
            edges.append({
                "source": source if forward >= reverse else target,
                "target": target if forward >= reverse else source,
                "value": value,
                "directed": directed,
            })
    return edges


def _basis_display_rotation(basis: str) -> np.ndarray:
    h = np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2)
    if basis == "x":
        return h
    return h @ np.array([[1, 0], [0, -1j]], dtype=complex)


def _apply_single_qubit(
    state: np.ndarray,
    qubit: int,
    matrix: np.ndarray,
) -> np.ndarray:
    result = state.copy()
    mask = 1 << qubit
    for base in range(state.size):
        if base & mask:
            continue
        paired = base | mask
        zero = state[base]
        one = state[paired]
        result[base] = matrix[0, 0] * zero + matrix[0, 1] * one
        result[paired] = matrix[1, 0] * zero + matrix[1, 1] * one
    return result


def _complex_pair(value: complex) -> list[float]:
    real = float(np.real(value))
    imag = float(np.imag(value))
    return [
        0.0 if abs(real) < 1e-12 else real,
        0.0 if abs(imag) < 1e-12 else imag,
    ]

class _SimOp(BaseModel):
    gate: str
    qubits: list[int]
    params: dict[str, float] = Field(default_factory=dict)


class SimulateRequest(BaseModel):
    num_qubits: int = Field(ge=1, le=12)
    operations: list[_SimOp]
    basis: Literal['x', 'y', 'z'] = 'z'
    metric: Metric = "k"
    markers: list[int] | None = None
    all_bases: bool = False
    all_metrics: bool = False


@app.post("/simulate")
def simulate(req: SimulateRequest) -> dict[str, Any]:
    
    ops = [op.model_dump() for op in req.operations]

    try:
        if req.all_metrics:
            grid = compute_markers_grid(req.num_qubits, ops, req.markers)
        elif req.all_bases:
            results_by_basis = compute_markers_all_basis(req.num_qubits, ops, req.markers)
        else:
            results = compute_markers(req.num_qubits, ops, req.basis, req.markers)

    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"interface error: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if req.all_metrics:
        return {"num_qubits": req.num_qubits, "results_by_metric_basis": grid}
    if req.all_bases:
        return {"num_qubits": req.num_qubits, "results_by_basis": results_by_basis}

    return {"basis": req.basis, "num_qubits": req.num_qubits, "results": results}


