import {edgeValue, metricLabel, metricMax, pairLabel} from "./metrics.js";

export function renderMatrix(data, state) {
  const canvas = document.getElementById("metric-matrix");
  const caption = document.getElementById("matrix-caption");
  const tooltip = document.getElementById("matrix-tooltip");
  const mean = document.getElementById("matrix-mean");
  const max = document.getElementById("matrix-max");
  const argmax = document.getElementById("matrix-argmax");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const label = metricLabel(state.metric, state.basis, data);
  caption.textContent = label;

  if (data?.stale) {
    caption.textContent = "Run to compute";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    tooltip.style.opacity = "0";
    mean.textContent = "-";
    max.textContent = "-";
    argmax.textContent = "-";
    return;
  }

  if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    mean.textContent = "-";
    max.textContent = "-";
    argmax.textContent = "-";
    return;
  }

  const n = data.nodes.length;
  const matrix = buildMatrix(data, n);
  const stats = matrixStats(matrix);
  mean.textContent = stats.mean.toFixed(4);
  max.textContent = stats.max.toFixed(4);
  argmax.textContent = stats.argmax ? pairLabel(...stats.argmax) : "-";

  const labelSize = 24;
  const panelWidth = canvas.parentElement.clientWidth || 320;
  const cellSize = Math.max(18, Math.min(42, Math.floor((panelWidth - labelSize - 8) / n)));
  canvas.width = labelSize + n * cellSize;
  canvas.height = labelSize + n * cellSize;

  const scaleMax = Math.max(metricMax(data), stats.max, 1);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const normalized = Math.max(0, Math.min(1, matrix[row][col] / scaleMax));
      const hue = 210 - 170 * normalized;
      const lightness = 94 - 48 * normalized;
      ctx.fillStyle = row === col ? "#f1f5f9" : `hsl(${hue}, 78%, ${lightness}%)`;
      ctx.fillRect(labelSize + col * cellSize, labelSize + row * cellSize, cellSize - 1, cellSize - 1);
    }
  }

  ctx.fillStyle = "#64748b";
  ctx.font = "11px JetBrains Mono, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    ctx.fillText(String(i), labelSize + i * cellSize + cellSize / 2, labelSize / 2);
    ctx.fillText(String(i), labelSize / 2, labelSize + i * cellSize + cellSize / 2);
  }

  canvas.onmousemove = event => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor((x - labelSize) / cellSize);
    const row = Math.floor((y - labelSize) / cellSize);
    if (row >= 0 && row < n && col >= 0 && col < n && row !== col) {
      tooltip.style.opacity = "1";
      tooltip.style.left = `${canvas.offsetLeft + x + 12}px`;
      tooltip.style.top = `${canvas.offsetTop + y - 8}px`;
      tooltip.textContent = `${label}(${pairLabel(row, col)}) = ${matrix[row][col].toFixed(4)}`;
    } else {
      tooltip.style.opacity = "0";
    }
  };
  canvas.onmouseleave = () => {
    tooltip.style.opacity = "0";
  };
}

function buildMatrix(data, n) {
  const matrix = Array.from({length: n}, () => Array(n).fill(0));
  for (const edge of data.edges || []) {
    const source = typeof edge.source === "object" ? edge.source.id : edge.source;
    const target = typeof edge.target === "object" ? edge.target.id : edge.target;
    if (source < 0 || source >= n || target < 0 || target >= n) continue;
    matrix[source][target] = edgeValue(edge);
    if (!edge.directed) matrix[target][source] = edgeValue(edge);
  }
  return matrix;
}

function matrixStats(matrix) {
  let sum = 0;
  let max = 0;
  let argmax = null;
  let count = 0;
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix.length; col++) {
      if (row === col) continue;
      const value = matrix[row][col];
      sum += value;
      count += 1;
      if (value > max) {
        max = value;
        argmax = [row, col];
      }
    }
  }
  return {mean: count ? sum / count : 0, max, argmax};
}
