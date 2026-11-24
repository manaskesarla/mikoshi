// The model is untrusted. Check every proposed action against what was actually offered.
//   validatePlan(response, { skeleton, vault, mode }) -> { ok: true, actions } | { ok: false, reason }
const MAX_ACTIONS = 5;
const KNOWN = new Set(["click", "type", "select", "scroll", "submit", "wait", "done", "navigate", "open_tab", "search", "extract", "ask_user"]);
const NEEDS_TARGET = new Set(["click", "type", "select", "submit"]);
const READ_ONLY_OK = new Set(["click", "scroll", "wait", "done", "navigate", "open_tab", "search", "extract", "ask_user"]);
const TOKEN_IN_TEXT = /\[[A-Z0-9]+_\d+\]/;

export function validatePlan(response, { skeleton, vault, mode = "act" }) {
  const actions = response?.actions;
  if (!Array.isArray(actions)) return { ok: false, reason: "response has no actions list" };
  if (actions.length > MAX_ACTIONS) return { ok: false, reason: "too many actions in one step" };
  const ids = new Set((skeleton?.nodes || []).map((n) => n.id));
  for (const a of actions) {
    if (!a || !KNOWN.has(a.action)) return { ok: false, reason: `unknown action ${String(a?.action).slice(0, 20)}` };
    if (mode === "read_only" && !READ_ONLY_OK.has(a.action)) return { ok: false, reason: `${a.action} is not allowed in read-only mode` };
    if (NEEDS_TARGET.has(a.action) && !ids.has(a.targetId)) return { ok: false, reason: "action targets an element that is not on the page" };
    if (a.action === "extract" && (!a.name || !(a.targetIds || []).length || a.targetIds.some((id) => !ids.has(id)))) return { ok: false, reason: "extract targets elements that are not on the page" };
    if (a.fillToken && !vault.has(a.fillToken)) return { ok: false, reason: "action uses a placeholder that does not exist" };
    if (a.literalValue && TOKEN_IN_TEXT.test(a.literalValue)) return { ok: false, reason: "placeholder written where a literal value belongs" };
    if (["type", "select"].includes(a.action) && !(a.fillToken || a.literalValue)) return { ok: false, reason: `${a.action} has no value` };
    if (["navigate", "open_tab"].includes(a.action) && !a.url) return { ok: false, reason: `${a.action} has no url` };
    if (a.action === "search" && !a.query) return { ok: false, reason: "search has no query" };
  }
  return { ok: true, actions };
}
