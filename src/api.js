const DEFAULT_API_BASE = "/api";

export function getApiBase() {
  const configuredBase = localStorage.getItem("api_url") || DEFAULT_API_BASE;
  return configuredBase.replace(/\/+$/, "");
}

export function apiUrl(path) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBase()}${suffix}`;
}

export async function apiGet(path) {
  return request(path);
}

export async function apiPost(path, payload) {
  return request(path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), options);
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {message: text};
    }
  }
  if (!response.ok) {
    const message = body.detail || body.message;
    const fallback = response.status === 404 ? "Backend missing" : `HTTP ${response.status}`;
    throw new Error(typeof message === "string" && message.length <= 140 ? message : fallback);
  }
  return body;
}
