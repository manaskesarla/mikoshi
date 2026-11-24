// Builds what the agent "sees" from the live page. Runs in the content script.
//   perceive() -> { skeleton, pageText, hidden, attributes, pageOrigin }
// Field VALUES are never included. They are read only to classify a field locally.
// Elements are remembered in a module-level registry (id -> element) so the page's own
// DOM is never modified and page scripts cannot see the mapping.

import { labelFor } from "../lib/label-assoc.mjs";
import { classifyFieldHeuristics } from "../lib/dlp-heuristics.mjs";

const registry = new Map();
export const getElement = (id) => registry.get(id) ?? null;

const MAX_NODES = 300;
const MAX_TEXT = 200;
const INTERACTIVE = "input, select, textarea, button, a[href], [role=button], [role=link]";
const INFORMATIVE = "h1, h2, h3, h4, p, li, td, th, dt, dd, caption, label";
const SKIP_INPUT_TYPES = new Set(["hidden", "image"]);

const clip = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

function isVisible(el, win) {
  if (!el.isConnected) return false;
  const cs = win.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > -1000 && r.bottom > -1000 && r.left < win.innerWidth + 1000 && r.left > -1000;
}

function implicitRole(el) {
  const t = el.tagName.toLowerCase();
  if (el.getAttribute("role")) return el.getAttribute("role");
  if (t === "a") return "link";
  if (t === "button") return "button";
  if (t === "select") return "combobox";
  if (t === "textarea") return "textbox";
  if (t === "input") {
    const ty = (el.type || "text").toLowerCase();
    return ty === "checkbox" ? "checkbox" : ty === "radio" ? "radio" : ["submit", "button", "reset"].includes(ty) ? "button" : "textbox";
  }
  if (/^h[1-6]$/.test(t)) return "heading";
  return undefined;
}

function fieldState(el) {
  const t = el.tagName.toLowerCase();
  if (t === "input" && ["checkbox", "radio"].includes((el.type || "").toLowerCase())) return el.checked ? "checked" : "unchecked";
  if (el.readOnly || el.disabled) return "readonly";
  if (t === "select") return el.value ? "filled" : "empty";
  return el.value ? "filled" : "empty";
}

function landmarkOf(el) {
  const l = el.closest("nav, main, header, footer, aside, form");
  return l ? l.tagName.toLowerCase() : undefined;
}

function nodeFor(el, id, doc, win) {
  const tag = el.tagName.toLowerCase();
  const isField = ["input", "select", "textarea"].includes(tag);
  const type = isField ? (el.type || "text").toLowerCase() : undefined;
  const r = el.getBoundingClientRect();
  const node = { id, tag, role: implicitRole(el), visible: isVisible(el, win), bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, landmark: landmarkOf(el) };
  if (type) node.type = type;

  if (isField || tag === "button") {
    const { label } = labelFor(el);
    node.label = clip(label);
    node.name = el.getAttribute("name") || el.id || undefined;
    node.required = !!el.required;
    if (isField) {
      node.state = fieldState(el);
      const c = classifyFieldHeuristics({
        signals: { type, name: el.getAttribute("name"), id: el.id, autocomplete: el.getAttribute("autocomplete"), label, placeholder: el.getAttribute("placeholder"), ariaLabel: el.getAttribute("aria-label"), title: el.getAttribute("title") },
        value: type === "password" ? "" : el.value, // classification only; the value is not stored on the node
      });
      if (c.category) node.piiCategory = c.category;
      node.isCensored = c.censor;
      if (tag === "select") node.options = [...el.options].slice(0, 50).map((o) => ({ text: clip(o.text), value: clip(o.value) }));
    } else {
      node.text = clip(el.textContent || el.value);
      node.state = "n/a";
    }
    node.isSubmit = (tag === "button" && (el.type || "submit") === "submit" && !!el.form) || (tag === "input" && type === "submit") || undefined;
  } else {
    node.label = "";
    node.state = "n/a";
    node.text = clip(el.textContent);
    if (tag === "a") node.href = el.href;
  }
  const form = el.form || el.closest?.("form");
  if (form && (isField || tag === "button")) {
    try {
      const origin = new URL(form.action || doc.location.href, doc.location.href).origin;
      node.formOrigin = origin;
      node.formCrossOrigin = origin !== doc.location.origin;
    } catch { /* unparseable action: leave unset */ }
  }
  return node;
}

export function buildSkeleton(doc = document, win = window) {
  registry.clear();
  const seen = new Set();
  const nodes = [];
  const add = (el) => {
    if (seen.has(el) || nodes.length >= MAX_NODES) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" && SKIP_INPUT_TYPES.has((el.type || "").toLowerCase())) return;
    if (!isVisible(el, win)) return;
    seen.add(el);
    const id = `n${nodes.length + 1}`;
    registry.set(id, el);
    nodes.push(nodeFor(el, id, doc, win));
  };
  const all = doc.querySelectorAll(`${INTERACTIVE}, ${INFORMATIVE}`);
  for (const el of all) {
    // a label that wraps its control is covered by the control itself
    if (el.tagName === "LABEL" && el.querySelector("input, select, textarea")) continue;
    // informative elements that only contain interactive ones add nothing
    add(el);
  }
  return {
    url: doc.location.href, title: clip(doc.title),
    viewport: { w: win.innerWidth, h: win.innerHeight }, scroll: { x: Math.round(win.scrollX), y: Math.round(win.scrollY) },
    nodes,
  };
}

export function collectPageText(doc = document) {
  return String(doc.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 8000);
}

/** Text that exists in the DOM but that a human could not see. Leaf-ish elements only. */
export function collectHidden(doc = document, win = window, limit = 100) {
  const out = [];
  for (const el of doc.body?.querySelectorAll("*") ?? []) {
    if (out.length >= limit) break;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "OPTION", "HEAD"].includes(el.tagName)) continue;
    if (el.children.length > 0) continue;
    const text = (el.textContent || "").trim();
    if (text.length < 8) continue;
    const cs = win.getComputedStyle(el);
    out.push({ text: text.slice(0, 500), style: { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, fontSize: cs.fontSize, width: cs.width, height: cs.height, overflow: cs.overflow, left: cs.left, top: cs.top, textIndent: cs.textIndent, color: cs.color, backgroundColor: cs.backgroundColor } });
  }
  return out.filter((h) => {
    const s = h.style;
    return s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05 || parseFloat(s.fontSize) < 2 || parseFloat(s.left) <= -1000 || parseFloat(s.top) <= -1000 || parseFloat(s.textIndent) <= -1000 || s.color === s.backgroundColor;
  });
}

export function collectAttributes(doc = document, limit = 80) {
  const out = [];
  for (const el of doc.querySelectorAll("[alt], [title], [aria-label]")) {
    for (const a of ["alt", "title", "aria-label"]) { const v = el.getAttribute(a); if (v && v.length >= 8) out.push(v.slice(0, 300)); }
    if (out.length >= limit) break;
  }
  return out;
}

export function perceive(doc = document, win = window) {
  return { skeleton: buildSkeleton(doc, win), pageText: collectPageText(doc), hidden: collectHidden(doc, win), attributes: collectAttributes(doc), pageOrigin: doc.location.origin };
}

export default { perceive, buildSkeleton, getElement };
