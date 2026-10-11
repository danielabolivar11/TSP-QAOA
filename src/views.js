const GATE_SYMBOL = {h: "H", x: "X", y: "Y", z: "Z", s: "S", t: "T", sx: "SX", rx: "RX", ry: "RY", rz: "RZ", sdg: "SDG", tdg: "TDG", cx: "CX", cy: "CY", cz: "CZ", crx: "CRX", cry: "CRY", crz: "CRZ", swap: "SWAP", mcx: "MCX"};
const CONTROLLED_TARGET = {cx: "X", cy: "Y", cz: "Z", crx: "RX", cry: "RY", crz: "RZ"};
const SVG_NS = "http://www.w3.org/2000/svg";
const CIRCUIT = {left: 66, right: 48, top: 40, row: 62, col: 84};

export function setStatus(message, tone = "neutral") {
  const status = document.getElementById("status");
  status.textContent = message;
  status.dataset.tone = tone;
}

export function renderGraphCaption(state, data) {
  const caption = document.getElementById("graph-caption");
  if (data?.stale) {
    caption.textContent = `Run to compute, ${state.basis.toUpperCase()} analysis basis`;
    return;
  }
  const metric = data?.metric_label || state.metric.toUpperCase();
  const markerLabel = data?.marker_label ? `, ${data.marker_label}` : "";
  caption.textContent = `${metric}, ${state.basis.toUpperCase()} analysis basis${markerLabel}`;
}

//export function renderCircuit(data) {
  //const container = document.getElementById("circuit");
  //container.innerHTML = data?.circuit_diagram || "No circuit.";
//}

export function renderCircuit(operations, numQubits, options = {}) {
  const container = document.getElementById("circuit");
  if (!container) return;

  const ops = Array.isArray(operations) ? operations : [];
  const n = Math.max(Number.parseInt(numQubits, 10) || 1, 1);
  const laneEnd = CIRCUIT.left + Math.max(ops.length, 1) * CIRCUIT.col;
  const height = CIRCUIT.top * 2 + (n - 1) * CIRCUIT.row;
  const width = laneEnd + CIRCUIT.right;

  container.innerHTML = "";
  const svg = svgElement("svg", {viewBox: `0 0 ${width} ${height}`, width, height, role: "group", "aria-label": "Quantum circuit"});
  for (let qubit = 0; qubit < n; qubit += 1) {
    const y = qubitY(qubit);
    svg.appendChild(svgElement("text", {class: "circuit-label", x: 12, y: y + 4}, `q${qubit}`));
    svg.appendChild(svgElement("line", {class: "circuit-wire", x1: CIRCUIT.left, y1: y, x2: laneEnd, y2: y}));
  }

  ops.forEach((op, index) => drawOperation(svg, op, index));
  for (let marker = 0; marker <= ops.length; marker += 1) {
    drawMarker(svg, marker, ops.length, height, options);
  }
  container.appendChild(svg);
}

function drawOperation(svg, op, index) {
  const qubits = normalizeQubits(op?.qubits);
  if (!qubits.length) return;

  const x = markerX(index) + CIRCUIT.col / 2;
  if (qubits.length === 1) {
    drawGateBox(svg, x, qubitY(qubits[0]), gateLabel(op));
    return;
  }

  const gate = String(op?.gate || "").toLowerCase();
  const ys = qubits.map(qubitY);
  svg.appendChild(svgElement("line", {
    class: "circuit-connector",
    x1: x,
    y1: Math.min(...ys),
    x2: x,
    y2: Math.max(...ys),
  }));

  if (gate === "swap") {
    for (const qubit of qubits.slice(0, 2)) {
      svg.appendChild(svgElement("text", {class: "circuit-swap", x, y: qubitY(qubit) + 6}, "x"));
    }
    return;
  }

  if (gate === "mcx") {
    const controls = qubits.slice(0, -1);
    const target = qubits[qubits.length - 1];
    for (const qubit of controls) {
      drawControl(svg, x, qubitY(qubit));
    }
    drawGateBox(svg, x, qubitY(target), "X");
    return;
  }

  const [control, target, ...rest] = qubits;
  drawControl(svg, x, qubitY(control));
  drawGateBox(svg, x, qubitY(target), CONTROLLED_TARGET[gate] || gateLabel(op));
  for (const qubit of rest) {
    drawGateBox(svg, x, qubitY(qubit), gateLabel(op));
  }
}

function drawMarker(svg, marker, maxMarker, height, options) {
  const status = options.markerStatus?.(marker) || "unmarked";
  const active = marker === (options.activeMarker ?? maxMarker);
  const x = markerX(marker);
  const g = svgElement("g", {
    class: `circuit-marker${active ? " is-active" : ""}`,
    "data-status": status,
    "data-marker": marker,
    role: "button",
    tabindex: 0,
    "aria-pressed": status !== "unmarked" ? "true" : "false",
  });
  g.appendChild(svgElement("title", {}, options.markerTitle?.(marker, status) || `Marker ${marker}`));
  g.appendChild(svgElement("line", {class: "circuit-marker-hit", x1: x, y1: 12, x2: x, y2: height - 12}));
  g.appendChild(svgElement("line", {class: "circuit-marker-line", x1: x, y1: 16, x2: x, y2: height - 16}));
  g.appendChild(svgElement("circle", {class: "circuit-marker-dot", cx: x, cy: 15, r: 4}));
  g.addEventListener("click", () => options.onMarkerClick?.(marker));
  g.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    options.onMarkerClick?.(marker);
  });
  svg.appendChild(g);
}

function drawGateBox(svg, x, y, label) {
  const width = Math.max(40, label.length * 9 + 18);
  svg.appendChild(svgElement("rect", {class: "circuit-gate", x: x - width / 2, y: y - 19, width, height: 38, rx: 6}));
  svg.appendChild(svgElement("text", {class: "circuit-gate-label", x, y: y + 4}, label));
}

function drawControl(svg, x, y) {
  svg.appendChild(svgElement("circle", {class: "circuit-control", cx: x, cy: y, r: 5}));
}

function gateLabel(op) {
  const gate = String(op?.gate || "?").toLowerCase();
  return GATE_SYMBOL[gate] || gate.toUpperCase();
}

function normalizeQubits(qubits) {
  return (Array.isArray(qubits) ? qubits : [])
    .map(qubit => Number.parseInt(qubit, 10))
    .filter(Number.isInteger);
}

function markerX(marker) {
  return CIRCUIT.left + marker * CIRCUIT.col;
}

function qubitY(qubit) {
  return CIRCUIT.top + qubit * CIRCUIT.row;
}

function svgElement(name, attrs = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value));
  }
  if (text !== undefined) element.textContent = text;
  return element;
}

export function renderOperations(operations) {
  const container = document.getElementById("operations-list");
  if (!container) return;

  //const operations = Array.isArray(data?.operations) ? data.operations : [];
  container.innerHTML = "";
  if (!operations.length) {
    container.textContent = "Input state.";
    return;
  }
  operations.forEach((op, index) => {
    const chip = document.createElement("span");
    chip.className = "operation-chip";
    chip.textContent = formatOperation(op, index + 1);
    container.appendChild(chip);
  });
}

  //for (const operation of operations) {
    //const item = document.createElement("span");
    //item.className = "operation-chip";
    //item.textContent = `${operation.id}. ${operation.label || operation.gate}`;
    //container.appendChild(item);
  //}
//}

function formatOperation(op, index) {
  const gate = op.gate.toUpperCase();
  const qubits = op.qubits.join(",");
  const angle = op.params?.angle;
  return angle != null
    ? `${index}. ${gate}(${Number(angle).toFixed(3)})[${qubits}]`
    : `${index}. ${gate}[${qubits}]`;
}

export function renderTimeline(data, state) {
  const input = document.getElementById("history-marker");
  const label = document.getElementById("history-label");
  const count = document.getElementById("history-count");
  if (!input || !label || !count) return;

  const markers = Array.isArray(data?.markers) ? data.markers : [];
  if (!markers.length) {
    input.disabled = true;
    input.min = 0;
    input.max = 0;
    input.value = 0;
    label.textContent = "Latest";
    count.textContent = "-";
    return;
  }

  const ids = markers.map(marker => Number(marker.id)).filter(Number.isInteger);
  const min = Math.min(...ids);
  const max = Math.max(...ids);
  const current = state.marker ?? Number(data.current_marker ?? max);
  const active = markers.find(marker => Number(marker.id) === current) || markers[markers.length - 1];

  input.disabled = false;
  input.min = min;
  input.max = max;
  input.step = 1;
  input.value = Number(active.id);
  label.textContent = active.label || `Marker ${active.id}`;
  count.textContent = `${active.id}/${max}`;
}

export function renderStatevector(data) {
  const target = document.getElementById("statevector");
  if (data?.stale) {
    target.textContent = "Run to compute statevector.";
    return;
  }
  const amplitudes = data?.amplitudes || [];
  if (!amplitudes.length) {
    target.textContent = "No statevector.";
    return;
  }
  target.textContent = amplitudes
    .filter(item => Number(item.magnitude_squared ?? 0) > 1e-6)
    .map(item => `${formatComplex(item.amplitude)} ${item.basis_state}`)
    .join("\n") || "0";
}

export function renderBasisGrid(data) {
  const container = document.getElementById("basis-grid");
  if (data?.stale) {
    container.innerHTML = "";
    container.textContent = "Run to compute state probabilities.";
    return;
  }
  const amplitudes = data?.amplitudes || [];
  container.innerHTML = "";
  if (!amplitudes.length) {
    container.textContent = "No amplitudes.";
    return;
  }

  const bits = bitCount(amplitudes);
  const columns = Math.pow(2, Math.ceil(bits / 2));
  container.style.gridTemplateColumns = `repeat(${columns}, minmax(42px, 1fr))`;

  for (const item of amplitudes) {
    const probability = Number(item.magnitude_squared ?? 0);
    const amplitude = item.amplitude || [0, 0];
    const phase = Math.atan2(amplitude[1] || 0, amplitude[0] || 0);
    const hue = ((phase * 180 / Math.PI) + 360) % 360;
    const cell = document.createElement("div");
    cell.className = "basis-cell";
    cell.style.background = `hsl(${hue}, 74%, ${96 - Math.min(48, probability * 80)}%)`;
    cell.innerHTML = `<span>${item.basis_state}</span><strong>${probability.toFixed(3)}</strong>`;
    container.appendChild(cell);
  }
}

export function renderPanelError(id, message) {
  const element = document.getElementById(id);
  if (element) element.textContent = message;
}

export function setQubitInputs(numQubits) {
  document.getElementById("qubit-count").max = 12;
  document.getElementById("qubit-count").value = numQubits;
}

function formatComplex(value = [0, 0]) {
  const real = Number(value[0] || 0);
  const imag = Number(value[1] || 0);
  if (Math.abs(imag) < 1e-9) return real.toFixed(3);
  if (Math.abs(real) < 1e-9) return `${imag.toFixed(3)}i`;
  return `${real.toFixed(3)} ${imag < 0 ? "-" : "+"} ${Math.abs(imag).toFixed(3)}i`;
}

function bitCount(amplitudes) {
  const first = amplitudes[0]?.basis_state || "|0>";
  const match = first.match(/\|(.+)>/);
  return match ? match[1].length : 1;
}
