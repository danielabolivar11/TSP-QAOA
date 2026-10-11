from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from importlib.resources import files
from typing import Any

from qcflows_api.circuit_model import CircuitModel, Operation


DEFAULT_EXPERIMENT_ID = "bell-pair"


@dataclass(frozen=True)
class StoredExperiment:
    id: str
    title: str
    description: str
    circuit: CircuitModel
    source: str = "builtin"
    default_view: dict[str, Any] = field(default_factory=dict)
    result_sets: tuple[dict[str, Any], ...] = ()
    provenance: dict[str, Any] = field(default_factory=dict)
    results_by_metric_basis: dict[str, Any] | None = None

    def summary_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "source": self.source,
            "num_qubits": self.circuit.num_qubits,
            "operation_count": len(self.circuit.operations),
            "default_view": dict(self.default_view),
            "result_sets": [dict(result_set) for result_set in self.result_sets],
        }

    def detail_payload(self, marker: int | None = None) -> dict[str, Any]:
        circuit_payload = self.circuit.circuit_payload(marker)
        timeline = self.circuit.timeline_payload()
        return {
            **self.summary_payload(),
            **circuit_payload,
            "markers": timeline["markers"],
            "timeline": timeline,
            "provenance": dict(self.provenance),
            "results_by_metric_basis": self.results_by_metric_basis,
        }


@lru_cache
def load_experiments() -> dict[str, StoredExperiment]:
    experiments: dict[str, StoredExperiment] = {}
    data_dir = files("qcflows_api").joinpath("data", "experiments")
    for resource in sorted(data_dir.iterdir(), key=lambda item: item.name):
        if resource.suffix != ".json":
            continue
        experiment = _parse_experiment(json.loads(resource.read_text()))
        experiments[experiment.id] = experiment
    return experiments


def get_experiment(experiment_id: str) -> StoredExperiment | None:
    return load_experiments().get(experiment_id)


def _parse_experiment(raw: dict[str, Any]) -> StoredExperiment:
    circuit = raw.get("circuit") or {}
    operations = tuple(
        Operation(
            id=index,
            gate=str(operation["gate"]).lower(),
            qubits=tuple(int(qubit) for qubit in operation.get("qubits", [])),
            params={
                str(key): float(value)
                for key, value in (operation.get("params") or {}).items()
            },
        )
        for index, operation in enumerate(circuit.get("operations") or [], start=1)
    )
    return StoredExperiment(
        id=str(raw["id"]),
        title=str(raw["title"]),
        description=str(raw.get("description") or ""),
        source=str(raw.get("source") or "builtin"),
        circuit=CircuitModel(
            num_qubits=int(circuit["num_qubits"]),
            operations=operations,
        ),
        default_view=dict(raw.get("default_view") or {}),
        result_sets=tuple(
            dict(result_set)
            for result_set in raw.get("result_sets") or []
        ),
        provenance=dict(raw.get("provenance") or {}),
        results_by_metric_basis=raw.get("results_by_metric_basis"),
    )
