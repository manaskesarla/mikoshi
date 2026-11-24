// Performs one validated action on the page. Runs in the content script.
//   execute(action, value) -> { ok, error?, navigated? }
// `value` is the real value, resolved locally by the service worker. It is typed into
// the field and then forgotten: never logged, never returned.

import { getElement, buildSkeleton } from "./perceiver.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
}
const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

function pick(el, wanted) {
  const w = String(wanted).trim().toLowerCase();
  const opt = [...el.options].find((o) => o.value.toLowerCase() === w || o.text.trim().toLowerCase() === w);
  return opt ? opt.value : null;
}

export async function execute(action, value, win = window) {
  const a = action || {};
  if (a.action === "wait") { await sleep(500); return { ok: true }; }
  if (a.action === "scroll") { win.scrollBy(0, Math.round(win.innerHeight * 0.8)); return { ok: true }; }
  if (a.action === "done" || a.action === "ask_user" || a.action === "extract") return { ok: true };

  if (a.action === "search") return runSearch(String(a.query ?? ""));

  const el = getElement(a.targetId);
  if (!el || !el.isConnected) return { ok: false, error: "element not found on the page any more" };

  try {
    el.scrollIntoView?.({ block: "center" });
    if (a.action === "type") {
      if (!["input", "textarea"].includes(el.tagName.toLowerCase())) return { ok: false, error: "target is not a text field" };
      const ty = (el.type || "text").toLowerCase();
      if (["checkbox", "radio", "file", "submit", "button"].includes(ty)) return { ok: false, error: `cannot type into a ${ty}` };
      if (el.readOnly || el.disabled) return { ok: false, error: "field is read-only" };
      el.focus();
      setNativeValue(el, String(value ?? ""));
      fire(el, "input"); fire(el, "change");
      if (el.value !== String(value ?? "")) return { ok: false, error: "the page changed the value after typing" };
      return { ok: true };
    }
    if (a.action === "select") {
      if (el.tagName.toLowerCase() !== "select") return { ok: false, error: "target is not a dropdown" };
      const v = pick(el, value);
      if (v === null) return { ok: false, error: "no matching option" };
      setNativeValue(el, v); fire(el, "input"); fire(el, "change");
      return { ok: true };
    }
    if (a.action === "submit") {
      const form = el.form || el.closest("form");
      if (form?.requestSubmit) form.requestSubmit(el.tagName === "BUTTON" || el.type === "submit" ? el : undefined); else el.click();
      return { ok: true };
    }
    if (a.action === "click") {
      const href = el.tagName === "A" ? el.getAttribute("href") : null;
      const navigates = !!href && !href.startsWith("#") && !/^javascript:/i.test(href) && el.target !== "_blank";
      el.click();
      return { ok: true, navigated: navigates };
    }
    return { ok: false, error: `action ${String(a.action).slice(0, 20)} is not performed in the page` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 80) };
  }
}

/** Fill the page's own search box and submit it. */
function runSearch(query, doc = document) {
  if (!query.trim()) return { ok: false, error: "empty search query" };
  const box = doc.querySelector('input[type="search"], [role="search"] input, input[role="searchbox"], input[name="q"], input[name="query"], input[name="search"]');
  if (!box || box.disabled || box.readOnly) return { ok: false, error: "this page has no search box" };
  box.focus();
  setNativeValue(box, query);
  fire(box, "input"); fire(box, "change");
  const form = box.form;
  if (form?.requestSubmit) form.requestSubmit(); else if (form) form.submit(); else return { ok: false, error: "search box is not in a form" };
  return { ok: true, navigated: true };
}

/** Text of the given nodes, for `extract`. */
export function readNodes(ids) {
  return (ids || []).map((id) => (getElement(id)?.innerText ?? getElement(id)?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1000));
}

export default { execute, readNodes, buildSkeleton };
