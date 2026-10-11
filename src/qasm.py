from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from qiskit import QuantumCircuit, qasm3

router = APIRouter()

_SINGLE = {"h", "x", "y", "z", "s", "t", "sdg", "tdg", "sx"}
_ROT = {"rx", "ry", "rz"}
_TWO = {"cx", "cz", "swap"}
_CROT = {"crx", "cry", "crz"}
_MULTI = {"mcx"}
_SUPPORTED = _SINGLE | _ROT | _TWO | _CROT | _MULTI


class _Op(BaseModel):
    gate: str
    qubits: list[int]
    params: dict[str, float] = Field(default_factory=dict)


class ExportQasmRequest(BaseModel):
    num_qubits: int = Field(ge=1, le=12)
    operations: list[_Op]


class ImportQasmRequest(BaseModel):
    qasm: str


def _ops_to_circuit(num_qubits: int, operations: list[dict]) -> QuantumCircuit:
    qc = QuantumCircuit(num_qubits)
    for op in operations:
        gate = str(op["gate"]).lower()
        qubits = [int(q) for q in op["qubits"]]
        params = op.get("params", {})
        if gate in _SINGLE:
            getattr(qc, gate)(qubits[0])
        elif gate in _ROT:
            angle = float(params.get("angle", params.get("theta", np.pi / 2)))
            getattr(qc, gate)(angle, qubits[0])
        elif gate in _TWO:
            getattr(qc, gate)(qubits[0], qubits[1])
        elif gate in _CROT:
            angle = float(params.get("angle", params.get("theta", np.pi / 2)))
            getattr(qc, gate)(angle, qubits[0], qubits[1])
        elif gate == "mcx":
            if len(qubits) < 2:
                raise ValueError("MCX requires at least one control and one target")
            qc.mcx(qubits[:-1], qubits[-1])
        else:
            raise ValueError(f"Unsupported gate: {gate!r}")
    return qc


def _circuit_to_ops(qc: QuantumCircuit) -> list[dict]:
    operations = []
    for instruction in qc.data:
        op = instruction.operation
        raw_gate = op.name.lower()
        gate = (
            "mcx"
            if raw_gate in {"ccx", "mcx"} or raw_gate.startswith("mcx_")
            else raw_gate
        )
        if gate not in _SUPPORTED:
            raise ValueError(f"Unsupported gate in QASM: {gate!r}")
        qubits = [qc.find_bit(q).index for q in instruction.qubits]
        params = {"angle": float(op.params[0])} if gate in _ROT | _CROT else {}
        operations.append({"gate": gate, "qubits": qubits, "params": params})
    return operations


@router.post("/export_qasm")
def export_qasm(req: ExportQasmRequest) -> dict[str, Any]:
    try:
        qc = _ops_to_circuit(req.num_qubits, [op.model_dump() for op in req.operations])
        return {"qasm": qasm3.dumps(qc)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/import_qasm")
def import_qasm(req: ImportQasmRequest) -> dict[str, Any]:
    try:
        qc = qasm3.loads(req.qasm)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"QASM parse error: {exc}") from exc
    try:
        operations = _circuit_to_ops(qc)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"num_qubits": qc.num_qubits, "operations": operations}
