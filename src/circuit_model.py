from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Operation:
    id: int
    gate: str
    qubits: tuple[int, ...]
    params: dict[str, float] = field(default_factory=dict)

    @property
    def label(self) -> str:
        qubits = ",".join(str(qubit) for qubit in self.qubits)
        if self.params:
            params = ", ".join(
                f"{name}={value:g}" for name, value in sorted(self.params.items())
            )
            return f"{self.gate.upper()}({qubits}; {params})"
        return f"{self.gate.upper()}({qubits})"

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "gate": self.gate,
            "qubits": list(self.qubits),
            "params": dict(self.params),
            "label": self.label,
        }


@dataclass(frozen=True)
class CircuitSnapshot:
    marker: int
    operations: tuple[Operation, ...]

    @property
    def label(self) -> str:
        if not self.operations:
            return "Input"
        return f"After {self.operations[-1].label}"


@dataclass(frozen=True)
class CircuitModel:
    num_qubits: int
    operations: tuple[Operation, ...]

    @property
    def latest_marker(self) -> int:
        return len(self.operations)

    def snapshot(self, marker: int | None = None) -> CircuitSnapshot:
        resolved_marker = self.latest_marker if marker is None else marker
        self.validate_marker(resolved_marker)
        return CircuitSnapshot(
            marker=resolved_marker,
            operations=self.operations[:resolved_marker],
        )

    def validate_marker(self, marker: int) -> None:
        if marker < 0 or marker > self.latest_marker:
            raise ValueError(
                f"marker must be between 0 and {self.latest_marker}"
            )

    def timeline_payload(self) -> dict[str, Any]:
        return {
            "current_marker": self.latest_marker,
            "markers": [
                {
                    "id": marker,
                    "label": self.snapshot(marker).label,
                    "operation_count": marker,
                }
                for marker in range(self.latest_marker + 1)
            ],
        }

    def operations_payload(self) -> dict[str, Any]:
        return {
            "num_qubits": self.num_qubits,
            "operation_count": len(self.operations),
            "operations": [
                operation.to_payload() for operation in self.operations
            ],
        }

    def circuit_payload(self, marker: int | None = None) -> dict[str, Any]:
        snapshot = self.snapshot(marker)
        return {
            "marker": snapshot.marker,
            "marker_label": snapshot.label,
            "num_qubits": self.num_qubits,
            "operation_count": len(snapshot.operations),
            "operations": [
                operation.to_payload() for operation in snapshot.operations
            ],
            "circuit_diagram": render_ascii_circuit(
                self.num_qubits,
                snapshot.operations,
            ),
        }


def render_ascii_circuit(
    num_qubits: int,
    operations: tuple[Operation, ...],
) -> str:
    rows = [f"q[{qubit}] |0> " for qubit in range(num_qubits)]
    if not operations:
        return f"<pre>{chr(10).join(row + '-----' for row in rows)}</pre>"

    for index, operation in enumerate(operations):
        first_operation = index == 0
        if operation.gate == "h" and len(operation.qubits) == 1:
            target = operation.qubits[0]
            for qubit in range(num_qubits):
                rows[qubit] += (
                    "-H-" if qubit == target else "---"
                ) if first_operation else (
                    "H-" if qubit == target else "--"
                )
            continue
        if operation.gate == "cx" and len(operation.qubits) == 2:
            control, target = operation.qubits
            for qubit in range(num_qubits):
                if qubit == control:
                    rows[qubit] += "-@-" if first_operation else "@-"
                elif qubit == target:
                    rows[qubit] += "-X-" if first_operation else "X-"
                else:
                    rows[qubit] += "---" if first_operation else "--"
            continue
        if operation.gate == "mcx" and len(operation.qubits) >= 2:
            controls = set(operation.qubits[:-1])
            target = operation.qubits[-1]
            for qubit in range(num_qubits):
                if qubit in controls:
                    rows[qubit] += "-@-" if first_operation else "@-"
                elif qubit == target:
                    rows[qubit] += "-X-" if first_operation else "X-"
                else:
                    rows[qubit] += "---" if first_operation else "--"
            continue

        label = operation.gate.upper()[:3].center(3, "-")
        targets = set(operation.qubits)
        for qubit in range(num_qubits):
            empty = "---" if first_operation else "--"
            rows[qubit] += label if qubit in targets else empty

    return f"<pre>{chr(10).join(rows)}</pre>"


_BELL_PAIR_CIRCUIT = CircuitModel(
    num_qubits=2,
    operations=(
        Operation(id=1, gate="h", qubits=(0,)),
        Operation(id=2, gate="cx", qubits=(0, 1)),
    ),
)

DEMO_CIRCUIT = _BELL_PAIR_CIRCUIT
