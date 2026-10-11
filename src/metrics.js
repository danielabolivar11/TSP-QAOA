export function edgeValue(edge) {
  const value = Number(edge?.value ?? edge?.concurrence ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function metricMax(data) {
  const value = Number(data?.metric_max ?? 1);
  return value > 0 ? value : 1;
}

export function metricLabel(metric, basis, data = null) {
  if (data?.metric_label) return data.metric_label;
  if (metric === "k") return `K_${basis.toUpperCase()}`;
  if (metric === "eof") return "EoF";
  return "MI";
}

export function pairLabel(source, target, directed = true) {
  return directed ? `${source}\u2192${target}` : `${source},${target}`;
}
