import {apiGet, apiPost} from "./api.js";
import {
  appState,
  setBasis,
  setMarker,
  setMetric,
  setNumQubits,
  setPendingGate,
  appendOp,
  removeLastOp,
  resetOps,
  replaceCircuit,
  loadPersisted,
  clearStale,
  markerStatus,
  selectedMarkerIds,
  dirtyMarkerIds,
  toggleMarkerSelection,
  markMarkersCached,
} from "./state.js";
import {initGraph, renderGraph} from "./graph.js?v=stale-compute-1";
import {renderMatrix} from "./matrix.js?v=stale-compute-1";
import {
  renderBasisGrid,
  renderCircuit,
  renderGraphCaption,
  renderOperations,
  renderPanelError,
  renderStatevector,
  renderTimeline,
  setQubitInputs,
  setStatus,
} from "./views.js?v=stale-compute-1";

const singleGateRoutes = {
  H: "/apply_hadamard",
  X: "/apply_x",
  T: "/apply_t",
  S: "/apply_s",
  Z: "/apply_z",
  Y: "/apply_y",
};

const rotationRoutes = {
  RX: "/apply_rx",
  RY: "/apply_ry",
  RZ: "/apply_rz",
};

const twoGateRoutes = {
  CX: "/apply_cx",
  CZ: "/apply_cz",
};

const metricHelp = {
  k: {
    title: "K metric",
    body: "Directional, analysis-basis-specific pair score: how much splitting one qubit along X, Y, or Z distinguishes the conditional states of the other.",
    href: "reference.html#metric-k",
  },
  eof: {
    title: "Entanglement of Formation",
    body: "Symmetric two-qubit entanglement measure. Zero for separable pairs; one for a maximally entangled Bell pair.",
    href: "reference.html#metric-eof",
  },
  mi: {
    title: "Mutual Information",
    body: "Symmetric total-correlation measure, including classical and quantum correlations. Values are in bits.",
    href: "reference.html#metric-mi",
  },
};

initGraph(handleGraphNodeClick);
initCollapsibleSections();
initPanelVisibility();

bindControls();
setQubitInputs(appState.numQubits);
initialize();

function bindControls() {
  bindSegmented("basis-control", "basis", value => {
    setBasis(value);
    appState.results = (appState.resultsBy[appState.metric] || {})[value] || [];
    syncSlider();
    renderActiveMarker();
    renderCircuitView();
    //refreshAll();
  });
  bindSegmented("metric-control", "metric", value => {
    setMetric(value);
    appState.results = (appState.resultsBy[value] || {})[appState.basis] || [];
    syncSlider();
    renderActiveMarker();
    renderCircuitView();
    //refreshGraph();
  });

  document.getElementById("run-circuit").addEventListener("click", runSimulation);
  document.getElementById("load-demo-experiment").addEventListener("click", loadSelectedDemoExperiment);


  document.getElementById("history-marker").addEventListener("input", event => {
    const marker = sliderMarker(Number.parseInt(event.target.value, 10));
    if (marker === null) return;
    setMarker(marker);
    //renderTimeline(appState.timelineData, appState);
    //refreshAll();
    renderActiveMarker();
    renderMarkerStrip();
    renderCircuitView();
  });

  document.querySelectorAll("[data-single-gate]").forEach(button => {
    button.addEventListener("click", () => {
      toggleGatePlacement({gate: button.dataset.singleGate, kind: "single"});
    });
  });

  document.querySelectorAll("[data-rotation-gate]").forEach(button => {
    button.addEventListener("click", () => {
      toggleGatePlacement({gate: button.dataset.rotationGate, kind: "rotation"});
    });
  });

  document.querySelectorAll("[data-two-gate]").forEach(button => {
    button.addEventListener("click", () => {
      toggleGatePlacement({gate: button.dataset.twoGate, kind: "two", control: null});
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !appState.pendingGate) return;
    event.preventDefault();
    clearPendingGate("Ready");
  });

  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    if (isTypingTarget(event.target)) return;
    if (moveMarker(event.key === "ArrowRight" ? 1 : -1)) {
      event.preventDefault();
    }
  });

  syncGateButtonState();
  bindMetricHelp();

  document.getElementById("set-qubits").addEventListener("click", () => {
    const requested = readInteger("qubit-count");
    //runAction(async () => {
      //const result = await apiPost("/set_num_qubits", {num_qubits: requested});
      //setNumQubits(result.num_qubits || requested);
      //setQubitInputs(appState.numQubits);
    //});
    setNumQubits(requested);
    setQubitInputs(appState.numQubits);
    afterEdit();
  });

  document.getElementById("undo-gate").addEventListener("click", () => {
    //runAction(() => apiPost("/remove_last_gate"));
    removeLastOp();
    afterEdit();
  });

  document.getElementById("reset-circuit").addEventListener("click", () => {
    //runAction(() => apiPost("/reset_circuit"));
    resetOps();
    afterEdit();
  });

  document.getElementById("import-qasm").addEventListener("click", async () => {
    const qasm = document.getElementById("qasm-input").value;
    try {
      setStatus("Importing QASM");
      const result = await apiPost("/import_qasm", {qasm});
      replaceCircuit(result.num_qubits, result.operations);
      setQubitInputs(appState.numQubits);
      afterEdit();
      setStatus("Needs run");
    } catch (error) {
      setStatus(error.message, "error");
    }
    //runAction(async () => {
      //const result = await apiPost("/import_qasm", {qasm});
      //if (result.num_qubits) {
        //setNumQubits(result.num_qubits);
        //setQubitInputs(appState.numQubits);
      //}
    //});
  });

  document.getElementById("load-current-qasm").addEventListener("click", async () => {
    try {
      setStatus("Loading QASM");
      //const result = await apiGet("/export_qasm");
      const result = await apiPost("/export_qasm", {num_qubits: appState.numQubits, operations: appState.operations});
      document.getElementById("qasm-input").value = result.qasm || "";
      setStatus("Ready", "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

async function refreshAll() {
  setStatus("Loading");
  const results = await Promise.allSettled([
    refreshGraph(),
    refreshState(),
    refreshCircuit(),
  ]);
  const failed = results.filter(result => result.status === "rejected");
  setStatus(failed.length ? "Backend missing" : "Ready", failed.length ? "error" : "ok");
}

function initialize() {
  loadPersisted();
  setQubitInputs(appState.numQubits);
  syncBasisControl();
  syncMetricControl();
  renderOperations(appState.operations);
  syncSlider();
  renderActiveMarker();
  renderMarkerStrip();
  renderCircuitView();
  renderStale();
  checkConnection();
  loadDemoExperiments();
}

async function loadDemoExperiments() {
  const select = document.getElementById("demo-experiment-select");
  const loadButton = document.getElementById("load-demo-experiment");
  if (!select || !loadButton) return;

  setDemoSelectMessage(select, "Loading");
  select.disabled = true;
  loadButton.disabled = true;

  try {
    const data = await apiGet("/experiments");
    const experiments = Array.isArray(data.experiments) ? data.experiments : [];
    select.replaceChildren();
    for (const experiment of experiments) {
      const option = document.createElement("option");
      option.value = experiment.id;
      option.textContent = experiment.title || experiment.id;
      option.title = experiment.description || "";
      select.appendChild(option);
    }
    const hasExperiments = experiments.length > 0;
    if (!hasExperiments) setDemoSelectMessage(select, "No examples");
    select.disabled = !hasExperiments;
    loadButton.disabled = !hasExperiments;
  } catch {
    setDemoSelectMessage(select, "Unavailable");
    select.disabled = true;
    loadButton.disabled = true;
  }
}

async function loadSelectedDemoExperiment() {
  const select = document.getElementById("demo-experiment-select");
  const experimentId = select?.value;
  if (!experimentId) return;

  try {
    setStatus("Loading example");
    const data = await apiGet(`/experiments/${encodeURIComponent(experimentId)}`);
    applyExperimentDefaults(data.default_view);
    replaceCircuit(data.num_qubits, normalizeDemoOperations(data.operations), {
      marker: data.default_view?.marker,
      resultsBy: data.results_by_metric_basis,
      stale: !hasPrecomputedResults(data.results_by_metric_basis),
    });
    setPendingGate(null);
    syncGateButtonState();
    setQubitInputs(appState.numQubits);
    afterEdit();
    setStatus(`Loaded ${data.title || "example"}`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function setDemoSelectMessage(select, message) {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = message;
  select.replaceChildren(option);
}

function applyExperimentDefaults(defaultView = {}) {
  if (defaultView.basis) {
    setBasis(defaultView.basis);
    syncBasisControl();
  }
  if (defaultView.metric) {
    setMetric(defaultView.metric);
    syncMetricControl();
  }
}

function hasPrecomputedResults(resultsBy) {
  if (!resultsBy || typeof resultsBy !== "object") return false;
  return Object.values(resultsBy).some(byBasis =>
    byBasis && typeof byBasis === "object" &&
      Object.values(byBasis).some(results => Array.isArray(results) && results.length)
  );
}

function normalizeDemoOperations(operations) {
  if (!Array.isArray(operations)) return [];
  return operations.map(operation => ({
    gate: String(operation.gate || "").toLowerCase(),
    qubits: Array.isArray(operation.qubits)
      ? operation.qubits
          .map(qubit => Number.parseInt(qubit, 10))
          .filter(Number.isInteger)
      : [],
    params: operation.params && typeof operation.params === "object"
      ? {...operation.params}
      : {},
  }));
}

//async function initialize() {
  //await refreshTimeline();
  //await refreshAll();
//}

async function checkConnection() {
  try {
    await apiGet("/health");
    setStatus("Ready", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function refreshTimeline() {
  try {
    const data = await apiGet("/timeline");
    appState.timelineData = data;
    if (appState.marker === null && Number.isInteger(Number(data.current_marker))) {
      setMarker(data.current_marker);
    }
    renderTimeline(data, appState);
  } catch {
    appState.timelineData = null;
    setMarker(null);
    renderTimeline(null, appState);
  }
}

async function refreshGraph() {
  const params = new URLSearchParams({basis: appState.basis, metric: appState.metric});
  appendMarker(params);
  try {
    const data = await apiGet(`/graph_data?${params.toString()}`);
    appState.graphData = data;
    const nodeCount = Array.isArray(data.nodes) ? data.nodes.length : appState.numQubits;
    setNumQubits(nodeCount);
    setQubitInputs(appState.numQubits);
    renderGraph(data, appState);
    renderMatrix(data, appState);
    renderGraphCaption(appState, data);
  } catch (error) {
    appState.graphData = null;
    renderGraph(null, appState);
    renderMatrix(null, appState);
    throw error;
  }
}

async function refreshState() {
  const params = new URLSearchParams({basis: appState.basis});
  appendMarker(params);
  try {
    const data = await apiGet(`/get_state?${params.toString()}`);
    appState.stateData = data;
    renderStatevector(data);
    renderBasisGrid(data);
  } catch (error) {
    renderPanelError("statevector", "Statevector unavailable.");
    renderPanelError("basis-grid", "States unavailable.");
    throw error;
  }
}

async function refreshCircuit() {
  const params = new URLSearchParams();
  appendMarker(params);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  try {
    const data = await apiGet(`/get_circuit${suffix}`);
    renderOperations(data.operations || appState.operations);
    renderCircuitView(data.operations || appState.operations, data.num_qubits || appState.numQubits);
  } catch (error) {
    renderPanelError("operations-list", "Operations unavailable.");
    renderPanelError("circuit", "Circuit unavailable.");
    throw error;
  }
}

async function runAction(action) {
  try {
    setStatus("Updating");
    await action();
    await refreshTimeline();
    selectLatestMarker();
    await refreshAll();
    return true;
  } catch (error) {
    setStatus(error.message, "error");
    return false;
  }
}

async function handleGraphNodeClick(qubitId) {
  const pending = appState.pendingGate;
  const qubit = normalizeQubitId(qubitId);

  if (!pending) return;

  if (pending.kind === "single") {
    //const ok = await runAction(() => apiPost(singleGateRoutes[pending.gate], {qubit_id: qubit}));
    appendOp({gate: pending.gate.toLowerCase(), qubits: [qubit], params: {}});
    setMarker(appState.operations.length);
    afterEdit();
    clearPendingGate("Ready");
    return;
  }

  if (pending.kind === "rotation") {
    const angle = Number.parseFloat(document.getElementById("rotation-angle").value);
    //const ok = await runAction(() => apiPost(rotationRoutes[pending.gate], {qubit_id: qubit, angle}));
    appendOp({gate: pending.gate.toLowerCase(), qubits: [qubit], params: {angle}});
    setMarker(appState.operations.length);
    afterEdit();
    clearPendingGate("Ready");
    return;
  }

  if (pending.kind === "two") {
    if (pending.control === null || pending.control === undefined) {
      setPendingGate({...pending, control: qubit});
      syncGateButtonState();
      renderGraph(appState.graphData, appState);
      setStatus(gatePlacementPrompt(appState.pendingGate));
      return;
    }

    if (sameQubit(pending.control, qubit)) {
      setStatus(`${pending.gate} target must differ from control.`, "error");
      return;
    }

    const control = normalizeQubitId(pending.control);
    //const ok = await runAction(() => apiPost(twoGateRoutes[pending.gate], {
      //control_id: control,
      //target_id: qubit,
    //}));
    appendOp({gate: pending.gate.toLowerCase(), qubits: [control, qubit], params: {}});
    setMarker(appState.operations.length);
    afterEdit();
    clearPendingGate("Ready");
  }
}

function toggleGatePlacement(nextGate) {
  const pending = appState.pendingGate;
  if (pending?.gate === nextGate.gate && pending?.kind === nextGate.kind) {
    clearPendingGate("Ready");
    return;
  }

  setPendingGate(nextGate);
  syncGateButtonState();
  renderGraph(appState.graphData, appState);
  setStatus(gatePlacementPrompt(appState.pendingGate));
}

function clearPendingGate(message = "") {
  setPendingGate(null);
  syncGateButtonState();
  renderGraph(appState.graphData, appState);
  if (message) {
    const nextMessage = message === "Ready" && appState.stale ? "Needs run" : message;
    setStatus(nextMessage, nextMessage === "Ready" ? "ok" : "neutral");
  }
}

function syncGateButtonState() {
  document.querySelectorAll("[data-single-gate], [data-rotation-gate], [data-two-gate]").forEach(button => {
    const gate = button.dataset.singleGate || button.dataset.rotationGate || button.dataset.twoGate;
    const active = appState.pendingGate?.gate === gate;
    button.classList.toggle("active-tool", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function gatePlacementPrompt(pending) {
  if (!pending) return "Ready";
  if (pending.kind === "two" && pending.control !== null && pending.control !== undefined) {
    return `${pending.gate} control q${pending.control}; click a different target node.`;
  }
  if (pending.kind === "two") {
    return `${pending.gate} selected; click the control qubit node.`;
  }
  return `${pending.gate} selected; click a qubit node.`;
}

function normalizeQubitId(qubitId) {
  const value = Number.parseInt(qubitId, 10);
  return Number.isInteger(value) ? value : 0;
}

function sameQubit(first, second) {
  return String(first) === String(second);
}

function selectLatestMarker() {
  const current = appState.timelineData?.current_marker;
  if (!Number.isInteger(Number(current))) return;
  setMarker(current);
  renderTimeline(appState.timelineData, appState);
}

function appendMarker(params) {
  if (appState.marker !== null) {
    params.set("marker", String(appState.marker));
  }
}

function renderCircuitView(operations = appState.operations, numQubits = appState.numQubits) {
  const ops = Array.isArray(operations) ? operations : appState.operations;
  renderCircuit(ops, numQubits, {
    activeMarker: appState.marker ?? ops.length,
    markerStatus,
    markerTitle,
    onMarkerClick: handleMarkerClick,
  });
}


function afterEdit() {
  renderOperations(appState.operations);
  syncSlider();
  renderActiveMarker();
  renderMarkerStrip();
  renderCircuitView();
  renderStale();
  if (appState.stale) setStatus("Needs run");
}


function placeholderGraph(stale = false) {
  return {
    stale,
    nodes: Array.from({length: appState.numQubits}, (_, index) => ({id: index})),
    edges: [],
  };
}

function renderActiveMarker() {
  const marker = appState.marker ?? appState.operations?.length ?? 0;
  appState.graphData = appState.stale
    ? placeholderGraph(true)
    : appState.results.find(result => result.marker === marker) || placeholderGraph();
  renderGraph(appState.graphData, appState);
  renderMatrix(appState.graphData, appState);
  renderGraphCaption(appState, appState.graphData);
  renderStatevector(appState.graphData);
  renderBasisGrid(appState.graphData);
}

async function runSimulation() {
  setStatus("Running");
  const selectedMarkers = selectedMarkerIds();
  const pendingMarkers = dirtyMarkerIds();
  if (selectedMarkers.length && !pendingMarkers.length) {
    setStatus("Markers cached", "ok");
    return;
  }

  const payload = {
    num_qubits: appState.numQubits,
    operations: appState.operations,
    all_metrics: true,
    //basis: appState.basis,
  };
  if (selectedMarkers.length) {
    payload.markers = pendingMarkers;
  }

  try {
    const data = await apiPost("/simulate", payload);
    const nextResults = data.results_by_metric_basis || {};
    appState.resultsBy = selectedMarkers.length
      ? mergeResultsByMarker(appState.resultsBy, nextResults)
      : nextResults;
    appState.results = (appState.resultsBy[appState.metric] || {})[appState.basis] || [];
    if (selectedMarkers.length) {
      markMarkersCached(pendingMarkers);
      setMarker(pendingMarkers[pendingMarkers.length - 1] ?? selectedMarkers[selectedMarkers.length - 1]);
    } else {
      setMarker(appState.operations.length);
    }
    clearStale();
    syncSlider();
    renderActiveMarker();
    renderMarkerStrip();
    renderCircuitView();
    renderStale();
    setStatus("Ready", "ok");
  } catch (error) {
    setStatus(error.message, "error"); // 502 = api could not reach interface
  }
}

function mergeResultsByMarker(current, incoming) {
  const merged = {};
  const metrics = new Set([
    ...Object.keys(current || {}),
    ...Object.keys(incoming || {}),
  ]);

  for (const metric of metrics) {
    merged[metric] = {};
    const bases = new Set([
      ...Object.keys(current?.[metric] || {}),
      ...Object.keys(incoming?.[metric] || {}),
    ]);
    for (const basis of bases) {
      const byMarker = new Map();
      for (const result of current?.[metric]?.[basis] || []) {
        byMarker.set(Number(result.marker), result);
      }
      for (const result of incoming?.[metric]?.[basis] || []) {
        byMarker.set(Number(result.marker), result);
      }
      merged[metric][basis] = Array.from(byMarker.values())
        .sort((a, b) => Number(a.marker) - Number(b.marker));
    }
  }
  return merged;
}

function syncSlider() {
  const input = document.getElementById("history-marker");
  const label = document.getElementById("history-label");
  const count = document.getElementById("history-count");

  const markers = navigableMarkers();
  if (!markers.length) {
    input.disabled = true;
    input.min = 0;
    input.max = 0;
    input.value = 0;
    label.textContent = "Latest";
    count.textContent = "-";
    return;
  }

  const index = closestMarkerIndex(markers, appState.marker ?? markers[markers.length - 1]);
  const current = markers[index];
  if (appState.marker !== current) setMarker(current);
  input.disabled = false;
  input.min = 0;
  input.max = markers.length - 1;
  input.step = 1;
  input.value = index;
  label.textContent = `Marker ${current}`;
  count.textContent = `${index + 1} / ${markers.length}`;
}

function navigableMarkers() {
  const selected = selectedMarkerIds();
  if (selected.length) return selected;
  if (appState.stale) {
    return Array.from({length: appState.operations.length + 1}, (_, index) => index);
  }
  return Array.from(new Set(appState.results.map(result => Number(result.marker))))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

function sliderMarker(index) {
  const markers = navigableMarkers();
  if (!markers.length || !Number.isInteger(index)) return null;
  return markers[Math.max(0, Math.min(markers.length - 1, index))];
}

function closestMarkerIndex(markers, marker) {
  const exact = markers.indexOf(Number(marker));
  if (exact !== -1) return exact;
  return markers.reduce((closest, candidate, index) => (
    Math.abs(candidate - marker) < Math.abs(markers[closest] - marker) ? index : closest
  ), 0);
}

function moveMarker(delta) {
  const markers = navigableMarkers();
  if (markers.length < 2) return false;
  const current = appState.marker ?? markers[markers.length - 1];
  const index = closestMarkerIndex(markers, current);
  const nextIndex = Math.max(0, Math.min(markers.length - 1, index + delta));
  const nextMarker = markers[nextIndex];
  if (nextMarker === appState.marker) return true;
  setMarker(nextMarker);
  syncSlider();
  renderActiveMarker();
  renderMarkerStrip();
  renderCircuitView();
  return true;
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && target.type !== "range";
}

function renderMarkerStrip() {
  const strip = document.getElementById("marker-strip");
  if (!strip) return;

  strip.innerHTML = "";
  const maxMarker = appState.operations.length;
  const activeMarker = appState.marker ?? maxMarker;
  for (let marker = 0; marker <= maxMarker; marker += 1) {
    const status = markerStatus(marker);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "marker-button";
    button.dataset.status = status;
    button.dataset.marker = marker;
    button.classList.toggle("is-active", activeMarker === marker);
    button.textContent = String(marker);
    button.title = markerTitle(marker, status);
    button.setAttribute("aria-label", markerTitle(marker, status));
    button.setAttribute("aria-pressed", status !== "unmarked" ? "true" : "false");
    button.addEventListener("mouseenter", () => highlightCircuitMarker(marker, true));
    button.addEventListener("mouseleave", () => highlightCircuitMarker(marker, false));
    button.addEventListener("focus", () => highlightCircuitMarker(marker, true));
    button.addEventListener("blur", () => highlightCircuitMarker(marker, false));
    button.addEventListener("click", () => handleMarkerClick(marker));
    strip.appendChild(button);
  }
}

function handleMarkerClick(marker) {
  const wasSelected = markerStatus(marker) !== "unmarked";
  toggleMarkerSelection(marker, hasCachedResult(marker) ? "cached" : "dirty");
  if (wasSelected) {
    removeMarkerResults(marker);
    if (appState.marker === marker) {
      setMarker(nextMarkerAfterRemoval(marker));
    }
  } else {
    setMarker(marker);
  }
  syncSlider();
  renderActiveMarker();
  renderMarkerStrip();
  renderCircuitView();
  renderStale();
}

function removeMarkerResults(marker) {
  for (const byBasis of Object.values(appState.resultsBy || {})) {
    for (const [basis, results] of Object.entries(byBasis || {})) {
      byBasis[basis] = Array.isArray(results)
        ? results.filter(result => Number(result.marker) !== marker)
        : results;
    }
  }
  appState.results = (appState.resultsBy[appState.metric] || {})[appState.basis] || [];
}

function nextMarkerAfterRemoval(removedMarker) {
  const selected = selectedMarkerIds();
  if (!selected.length) return appState.operations.length;
  return selected.reduce((closest, marker) => {
    const closestDistance = Math.abs(closest - removedMarker);
    const markerDistance = Math.abs(marker - removedMarker);
    return markerDistance < closestDistance ? marker : closest;
  }, selected[0]);
}

function markerTitle(marker, status) {
  const statusLabel = status === "cached"
    ? "cached"
    : status === "dirty"
      ? "needs run"
      : "";
  return [markerOperationLabel(marker), statusLabel].filter(Boolean).join("\n");
}

function markerOperationLabel(marker) {
  if (marker <= 0) return "Input state";
  const operation = appState.operations[marker - 1];
  if (!operation) return "Operation unavailable";
  return formatMarkerOperation(operation);
}

function formatMarkerOperation(operation) {
  const gate = String(operation.gate || "?").toUpperCase();
  const qubits = Array.isArray(operation.qubits) ? operation.qubits.join(",") : "";
  const angle = operation.params?.angle;
  return angle != null
    ? `${gate}(${Number(angle).toFixed(3)})[${qubits}]`
    : `${gate}[${qubits}]`;
}

function highlightCircuitMarker(marker, highlighted) {
  document
    .querySelectorAll(`.circuit-marker[data-marker="${marker}"]`)
    .forEach(node => node.classList.toggle("is-hovered", highlighted));
}

function hasCachedResult(marker) {
  for (const byBasis of Object.values(appState.resultsBy || {})) {
    for (const results of Object.values(byBasis || {})) {
      if (Array.isArray(results) && results.some(result => Number(result.marker) === marker)) {
        return true;
      }
    }
  }
  return false;
}


function renderStale() {
  const hint = document.getElementById("circuit-stale");
  if (hint) hint.hidden = !appState.stale;
  const run = document.getElementById("run-circuit");
  if (run) run.classList.toggle("needs-run", appState.stale);
}

function syncBasisControl() {
  document.querySelectorAll("#basis-control button").forEach(button => {
    button.classList.toggle("active", button.dataset.basis === appState.basis);
  });
}

function syncMetricControl() {
  document.querySelectorAll("#metric-control button").forEach(button => {
    button.classList.toggle("active", button.dataset.metric === appState.metric);
  });
}

function bindMetricHelp() {
  const popover = document.getElementById("metric-help-popover");
  const title = document.getElementById("metric-help-title");
  const body = document.getElementById("metric-help-body");
  const link = document.getElementById("metric-help-link");
  const buttons = document.querySelectorAll("#metric-control [data-metric]");
  if (!popover || !title || !body || !link || !buttons.length) return;

  let hideTimer = null;
  const clearHide = () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = null;
  };
  const show = button => {
    const info = metricHelp[button.dataset.metric];
    if (!info) return;
    clearHide();
    title.textContent = info.title;
    body.textContent = info.body;
    link.href = info.href;
    popover.hidden = false;
  };
  const hide = () => {
    clearHide();
    hideTimer = window.setTimeout(() => {
      popover.hidden = true;
    }, 120);
  };

  buttons.forEach(button => {
    const info = metricHelp[button.dataset.metric];
    if (info) button.title = `${info.title}: ${info.body}`;
    button.addEventListener("mouseenter", () => show(button));
    button.addEventListener("focus", () => show(button));
    button.addEventListener("mouseleave", hide);
    button.addEventListener("blur", hide);
  });
  popover.addEventListener("mouseenter", clearHide);
  popover.addEventListener("mouseleave", hide);
}

function bindSegmented(id, dataKey, handler) {
  document.getElementById(id).addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const item of event.currentTarget.querySelectorAll("button")) {
      item.classList.toggle("active", item === button);
    }
    handler(button.dataset[dataKey]);
  });
}

function readInteger(id) {
  const value = Number.parseInt(document.getElementById(id).value, 10);
  return Number.isInteger(value) ? value : 0;
}

function initCollapsibleSections() {
  document.querySelectorAll("[data-collapsible]").forEach((section, index) => {
    const sourceHeader = section.querySelector(":scope > .panel-header") || section.querySelector(":scope > h2");
    if (!sourceHeader) return;

    const key = section.dataset.collapseKey || String(index);
    const content = document.createElement("div");
    content.className = "collapsible-content";
    content.id = `collapse-${key}`;

    const {anchor, heading, label} = prepareCollapseHeading(section, sourceHeader);
    const toggle = createCollapseToggle(content.id);
    heading.insertBefore(toggle, heading.firstChild);

    let next = anchor.nextSibling;
    while (next) {
      const current = next;
      next = next.nextSibling;
      if (current.nodeType === Node.ELEMENT_NODE && current.matches("[data-collapse-persistent]")) {
        continue;
      }
      content.appendChild(current);
    }
    section.appendChild(content);

    const stored = readCollapseState(key);
    const collapsed = stored ?? section.dataset.collapseDefault === "closed";
    setCollapsed(section, content, toggle, collapsed, label);

    toggle.addEventListener("click", () => {
      const nextCollapsed = section.dataset.collapsed !== "true";
      setCollapsed(section, content, toggle, nextCollapsed, label);
      writeCollapseState(key, nextCollapsed);
      if (!nextCollapsed) refreshExpandedSection(section);
    });
  });
}

function prepareCollapseHeading(section, sourceHeader) {
  if (sourceHeader.matches("h2")) {
    const heading = document.createElement("div");
    heading.className = "collapse-heading";
    section.insertBefore(heading, sourceHeader);
    heading.appendChild(sourceHeader);
    return {
      anchor: heading,
      heading,
      label: sourceHeader.textContent.trim() || "Section",
    };
  }

  const title = sourceHeader.querySelector("h2");
  const heading = document.createElement("div");
  heading.className = "collapse-heading";
  if (title) {
    sourceHeader.insertBefore(heading, title);
    heading.appendChild(title);
  } else {
    sourceHeader.insertBefore(heading, sourceHeader.firstChild);
  }

  return {
    anchor: sourceHeader,
    heading,
    label: title?.textContent.trim() || "Section",
  };
}

function createCollapseToggle(contentId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "collapse-toggle";
  button.setAttribute("aria-controls", contentId);

  const icon = document.createElement("span");
  icon.className = "collapse-icon";
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);
  return button;
}

function setCollapsed(section, content, toggle, collapsed, label) {
  section.dataset.collapsed = collapsed ? "true" : "false";
  content.hidden = collapsed;
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const action = collapsed ? "Expand" : "Collapse";
  toggle.setAttribute("aria-label", `${action} ${label}`);
  toggle.title = `${action} ${label}`;
}

function refreshExpandedSection(section) {
  requestAnimationFrame(() => {
    refreshVisiblePanel(section);
  });
}

function initPanelVisibility() {
  document.querySelectorAll("[data-panel-toggle]").forEach(toggle => {
    const key = toggle.dataset.panelToggle;
    const panel = document.querySelector(`[data-panel-key="${key}"]`);
    if (!panel) return;

    const visible = readPanelVisibility(key, toggle.checked);
    toggle.checked = visible;
    setPanelVisible(panel, visible);

    toggle.addEventListener("change", () => {
      setPanelVisible(panel, toggle.checked);
      writePanelVisibility(key, toggle.checked);
      if (toggle.checked) {
        refreshVisiblePanel(panel);
      }
    });
  });
}

function setPanelVisible(panel, visible) {
  panel.hidden = !visible;
}

function refreshVisiblePanel(panel) {
  requestAnimationFrame(() => {
    if (panel.hidden) return;
    if (panel.querySelector("#metric-matrix")) {
      renderMatrix(appState.graphData, appState);
    }
    if (panel.querySelector("#graph")) {
      renderGraph(appState.graphData, appState);
    }
  });
}

function readPanelVisibility(key, defaultVisible) {
  try {
    const value = localStorage.getItem(panelStorageKey(key));
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    return defaultVisible;
  }
  return defaultVisible;
}

function writePanelVisibility(key, visible) {
  try {
    localStorage.setItem(panelStorageKey(key), visible ? "true" : "false");
  } catch {
    // Ignore storage failures; panel visibility still applies for this session.
  }
}

function panelStorageKey(key) {
  return `qcflows:panel:${key}`;
}

function readCollapseState(key) {
  try {
    const value = localStorage.getItem(collapseStorageKey(key));
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    return null;
  }
  return null;
}

function writeCollapseState(key, collapsed) {
  try {
    localStorage.setItem(collapseStorageKey(key), collapsed ? "true" : "false");
  } catch {
    // Ignore storage failures; collapse state is still applied for the current session.
  }
}

function collapseStorageKey(key) {
  return `qcflows:collapse:${key}`;
}
