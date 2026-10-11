import {edgeValue, metricMax, metricLabel, pairLabel} from "./metrics.js";

const size = {width: 720, height: 520};
const positiveBasisStates = {
  z: "|0>",
  x: "|+>",
  y: "|i>",
};
let svg;
let simulation;
let handleNodeSelect;

export function initGraph(onNodeSelect) {
  handleNodeSelect = onNodeSelect;
  svg = d3.select("#graph")
    .append("svg")
    .attr("viewBox", `0 0 ${size.width} ${size.height}`)
    .attr("role", "img");

  svg.append("defs").append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -4 10 8")
    .attr("refX", 28)
    .attr("refY", 0)
    .attr("markerWidth", 5)
    .attr("markerHeight", 5)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-4L10,0L0,4")
    .attr("fill", "#64748b");

  svg.append("g").attr("class", "links");
  svg.append("g").attr("class", "nodes");

  simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(d => d.id).distance(160))
    .force("charge", d3.forceManyBody().strength(-420))
    .force("center", d3.forceCenter(size.width / 2, size.height / 2))
    .force("x", d3.forceX(d => {
      const count = Math.max(1, simulation?.nodes().length || 1);
      const angle = 2 * Math.PI * d.id / count - Math.PI / 2;
      return size.width / 2 + 230 * Math.cos(angle);
    }).strength(0.75))
    .force("y", d3.forceY(d => {
      const count = Math.max(1, simulation?.nodes().length || 1);
      const angle = 2 * Math.PI * d.id / count - Math.PI / 2;
      return size.height / 2 + 190 * Math.sin(angle);
    }).strength(0.75));

  simulation.on("tick", () => {
    svg.selectAll(".link").attr("d", d => {
      const source = d.source;
      const target = d.target;
      if (!d.directed) return `M${source.x},${source.y}L${target.x},${target.y}`;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
      return `M${source.x},${source.y}A${dr},${dr} 0 0,1 ${target.x},${target.y}`;
    });
    svg.selectAll(".node-group").attr("transform", d => `translate(${d.x},${d.y})`);
  });
}

export function renderGraph(data, state) {
  if (!svg || !simulation) return;
  if (!data || !Array.isArray(data.nodes)) {
    d3.select("#graph")
      .classed("is-empty", true)
      .classed("is-stale", false)
      .classed("placement-active", false)
      .attr("data-placement-label", null);
    return;
  }

  d3.select("#graph")
    .classed("is-empty", false)
    .classed("is-stale", Boolean(data.stale))
    .classed("placement-active", Boolean(state?.pendingGate))
    .attr("data-placement-label", placementLabel(state));
  const nodes = mergeNodes(simulation.nodes(), data.nodes.map(node => ({...node})));
  const edges = (data.edges || []).map(edge => ({...edge}));
  const scaleMax = metricMax(data);
  const label = metricLabel(state.metric, state.basis, data);

  const link = svg.select(".links")
    .selectAll("path.link")
    .data(edges, edgeKey);

  const linkEnter = link.enter()
    .append("path")
    .attr("class", "link")
    .attr("fill", "none")
    .attr("stroke", "#64748b")
    .attr("marker-end", d => d.directed ? "url(#arrowhead)" : null);

  linkEnter.append("title");

  const allLinks = linkEnter.merge(link);
  allLinks
    .attr("stroke-width", d => 1 + 5 * Math.sqrt(Math.min(1, edgeValue(d) / scaleMax)))
    .attr("marker-end", d => d.directed ? "url(#arrowhead)" : null);
  allLinks.select("title")
    .text(d => {
      const source = nodeId(d.source);
      const target = nodeId(d.target);
      return `${label}(${pairLabel(source, target, d.directed)}) = ${edgeValue(d).toFixed(3)}`;
    });

  link.exit().remove();

  const node = svg.select(".nodes")
    .selectAll("g.node-group")
    .data(nodes, d => d.id);

  const nodeEnter = node.enter()
    .append("g")
    .attr("class", "node-group")
    .attr("role", "button")
    .attr("tabindex", 0)
    .call(d3.drag()
      .on("start", dragStarted)
      .on("drag", dragged)
      .on("end", dragEnded));

  nodeEnter.append("circle")
    .attr("class", "node")
    .attr("r", 18);

  nodeEnter.append("text")
    .attr("class", "node-label")
    .attr("dy", "0.35em")
    .text(d => d.id);

  nodeEnter.append("title");

  nodeEnter.on("click", (event, d) => {
    if (event.defaultPrevented) return;
    handleNodeSelect?.(d.id);
  });
  nodeEnter.on("keydown", (event, d) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleNodeSelect?.(d.id);
  });

  const allNodes = nodeEnter.merge(node);
  allNodes
    .classed("placement-target", d => isPlacementTarget(d, state))
    .classed("pending-origin", d => isPendingOrigin(d, state))
    .attr("aria-label", d => nodeAriaLabel(d, state, data));
  allNodes.select("circle")
    .attr("fill", d => data.stale ? "#e2e8f0" : d3.interpolateBlues(Number(d.prob0 ?? 0.5)))
    .attr("stroke", "#0f172a");
  allNodes.select("title")
    .text(d => nodeTitle(d, state, data));

  node.exit().remove();

  simulation.nodes(nodes);
  simulation.force("link").links(edges);
  simulation.alpha(0.4).restart();
}

function mergeNodes(oldNodes, newNodes) {
  for (const node of newNodes) {
    const previous = oldNodes.find(oldNode => oldNode.id === node.id);
    if (previous) {
      node.x = previous.x;
      node.y = previous.y;
      node.vx = previous.vx;
      node.vy = previous.vy;
    }
  }
  return newNodes;
}

function edgeKey(edge) {
  const source = nodeId(edge.source);
  const target = nodeId(edge.target);
  return `${source}${edge.directed ? ">" : "-"}${target}`;
}

function nodeId(node) {
  return typeof node === "object" ? node.id : node;
}

function isPlacementTarget(node, state) {
  const pending = state?.pendingGate;
  if (!pending) return false;
  if (pending.kind === "two" && pending.control !== null && pending.control !== undefined) {
    return !sameId(node.id, pending.control);
  }
  return true;
}

function isPendingOrigin(node, state) {
  const pending = state?.pendingGate;
  return pending?.kind === "two" &&
    pending.control !== null &&
    pending.control !== undefined &&
    sameId(node.id, pending.control);
}

function nodeTitle(node, state, data) {
  if (data?.stale) {
    return `Qubit ${node.id}\nRun to compute probability`;
  }
  const base = `Qubit ${node.id}\nP(${positiveBasisState(state)}) = ${nodeProbability(node)}`;
  const pending = state?.pendingGate;
  if (!pending) return base;
  if (isPendingOrigin(node, state)) return `${base}\n${pending.gate} control selected`;
  if (isPlacementTarget(node, state)) return `${base}\nPlace ${pending.gate} here`;
  return base;
}

function nodeAriaLabel(node, state, data) {
  const pending = state?.pendingGate;
  if (data?.stale) {
    const base = `Qubit ${node.id}; run to compute probability`;
    if (!pending) return `Select qubit ${node.id}; run to compute probability`;
    if (isPendingOrigin(node, state)) return `${base}, ${pending.gate} control selected`;
    if (isPlacementTarget(node, state)) return `Place ${pending.gate} on qubit ${node.id}; run to compute probability`;
    return base;
  }
  const probability = `P(${positiveBasisState(state)}) = ${nodeProbability(node)}`;
  if (!pending) return `Select qubit ${node.id}; ${probability}`;
  if (isPendingOrigin(node, state)) return `Qubit ${node.id}, ${probability}, ${pending.gate} control selected`;
  if (isPlacementTarget(node, state)) return `Place ${pending.gate} on qubit ${node.id}; ${probability}`;
  return `Qubit ${node.id}; ${probability}`;
}

function positiveBasisState(state) {
  return positiveBasisStates[state?.basis] || positiveBasisStates.z;
}

function nodeProbability(node) {
  return Number(node.prob0 ?? 0).toFixed(3);
}

function sameId(first, second) {
  return String(first) === String(second);
}

function placementLabel(state) {
  const pending = state?.pendingGate;
  if (!pending) return null;
  if (pending.kind === "two" && pending.control !== null && pending.control !== undefined) {
    return `${pending.gate} q${pending.control} -> ?`;
  }
  if (pending.kind === "two") return `${pending.gate}: choose control`;
  return `${pending.gate}: choose qubit`;
}

function placementActive() {
  return d3.select("#graph").classed("placement-active");
}

function dragStarted(event, d) {
  if (placementActive()) return;
  if (!event.active) simulation.alphaTarget(0.3);
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  if (placementActive()) return;
  d.fx = event.x;
  d.fy = event.y;
}

function dragEnded(event, d) {
  if (placementActive()) return;
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}
