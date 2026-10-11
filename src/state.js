const STORAGE_KEY = "qcflows:circuit";

export const appState = {
  basis: "z",
  metric: "k",
  marker: null,
  numQubits: 5,
  operations: [],
  results: [],
  resultsBy: {},
  graphData: null,
  stale: true,
  stateData: null,
  timelineData: null,
  pendingGate: null,
  markerSelections: {},
};

export function appendOp(op) {
  appState.operations.push(op);
  markStale();
}

export function removeLastOp() {
  appState.operations.pop();
  markStale();
}

export function resetOps() {
  appState.operations = [];
  markStale();
}


export function replaceCircuit(numQubits, operations, options = {}) {
  const next = Number.parseInt(numQubits, 10);
  if (Number.isInteger(next) && next > 0) {
    appState.numQubits = next;
  }
  appState.operations = Array.isArray(operations) ? operations : [];
  appState.resultsBy = options.resultsBy && typeof options.resultsBy === "object"
    ? options.resultsBy
    : {};
  appState.results = (appState.resultsBy[appState.metric] || {})[appState.basis] || [];
  appState.marker = null;
  appState.markerSelections = {};
  setMarker(options.marker);
  if (options.stale === false) {
    appState.stale = false;
    persist();
  } else {
    markStale();
  }
}


export function setBasis(basis) {
  appState.basis = basis;
  persist();
}

export function setMetric(metric) {
  appState.metric = metric;
  persist();
}

export function setMarker(marker) {
  if (marker === null || marker === undefined || marker === "") {
    appState.marker = null;
    return;
  }
  const next = Number.parseInt(marker, 10);
  if (Number.isInteger(next) && next >= 0) {
    appState.marker = next;
  }
}

export function setNumQubits(numQubits) {
  const next = Number.parseInt(numQubits, 10);
  if (Number.isInteger(next) && next > 0) {
    appState.numQubits = next;
    appState.operations = [];
    appState.results = [];
    appState.resultsBy = {};
    appState.marker = null;
    markStale();
  }
}

export function setPendingGate(pendingGate) {
  appState.pendingGate = pendingGate ? {...pendingGate} : null;
}

export function clearStale() {
  appState.stale = false;
}

export function markerStatus(marker) {
  return appState.markerSelections[String(marker)] || "unmarked";
}

export function selectedMarkerIds() {
  return Object.keys(appState.markerSelections)
    .map(value => Number.parseInt(value, 10))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

export function dirtyMarkerIds() {
  return selectedMarkerIds().filter(marker => markerStatus(marker) !== "cached");
}

export function toggleMarkerSelection(marker, status = "dirty") {
  const key = String(marker);
  if (appState.markerSelections[key]) {
    delete appState.markerSelections[key];
  } else {
    appState.markerSelections[key] = status;
  }
  persist();
}

export function markMarkersCached(markers) {
  for (const marker of markers) {
    const key = String(marker);
    if (appState.markerSelections[key]) {
      appState.markerSelections[key] = "cached";
    }
  }
  persist();
}

function markStale() {
  appState.stale = true;
  markSelectedMarkersDirty();
  persist();
} 

function markSelectedMarkersDirty() {
  const maxMarker = appState.operations.length;
  const next = {};
  for (const marker of selectedMarkerIds()) {
    if (marker <= maxMarker) next[String(marker)] = "dirty";
  }
  appState.markerSelections = next;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      operations: appState.operations,
      numQubits: appState.numQubits,
      basis: appState.basis,
      metric: appState.metric,
      markerSelections: appState.markerSelections,
    }));
  } catch (e) {
    console.warn("Failed to persist state", e);
  }
}


export function loadPersisted() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (Array.isArray(saved.operations)) appState.operations = saved.operations;
    if (saved.numQubits) appState.numQubits = saved.numQubits;
    if (saved.basis) appState.basis = saved.basis;
    if (saved.metric) appState.metric = saved.metric;
    if (saved.markerSelections && typeof saved.markerSelections === "object") {
      appState.markerSelections = Object.fromEntries(
        Object.keys(saved.markerSelections)
          .map(value => Number.parseInt(value, 10))
          .filter(marker => Number.isInteger(marker) && marker <= appState.operations.length)
          .map(marker => [String(marker), "dirty"])
      );
    }
  } catch (e) {
    console.warn("Failed to load persisted state", e);
  }
}
