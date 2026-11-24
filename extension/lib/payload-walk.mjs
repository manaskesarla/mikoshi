// Walk every string inside a JSON-like payload, yielding { path, value }.
// Structural keys (ids, enums) and image data are skipped by default.

export const DEFAULT_SKIP_KEYS = new Set([
  "screenshot", "id", "tag", "type", "role", "state", "action", "targetId", "fillToken", "piiCategory", "mode", "model",
]);

export function* walkStrings(node, { skipKeys = DEFAULT_SKIP_KEYS, minLength = 3 } = {}, path = "") {
  if (node == null) return;
  if (typeof node === "string") {
    if (node.length >= minLength) yield { path, value: node };
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* walkStrings(node[i], { skipKeys, minLength }, `${path}[${i}]`);
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (skipKeys.has(k)) continue;
      yield* walkStrings(v, { skipKeys, minLength }, path ? `${path}.${k}` : k);
    }
  }
}

/** Deep copy of `node`, applying `fn(string, path)` to every walked string. */
export function mapStrings(node, fn, { skipKeys = DEFAULT_SKIP_KEYS, minLength = 3 } = {}, path = "") {
  if (typeof node === "string") return node.length >= minLength ? fn(node, path) : node;
  if (Array.isArray(node)) return node.map((x, i) => mapStrings(x, fn, { skipKeys, minLength }, `${path}[${i}]`));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = skipKeys.has(k) ? v : mapStrings(v, fn, { skipKeys, minLength }, path ? `${path}.${k}` : k);
    return out;
  }
  return node;
}

export default { walkStrings, mapStrings, DEFAULT_SKIP_KEYS };
