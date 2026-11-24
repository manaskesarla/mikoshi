import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLabel, collectLabelCandidates, labelFor } from "../extension/lib/label-assoc.mjs";

test("pickLabel priority and whitespace cleanup", () => {
  assert.deepEqual(pickLabel([{ source: "placeholder", text: "x" }, { source: "aria-label", text: "  Phone \n number " }]), { label: "Phone number", source: "aria-label" });
  assert.deepEqual(pickLabel([{ source: "name", text: "n" }, { source: "label-for", text: "Email" }]), { label: "Email", source: "label-for" });
  assert.deepEqual(pickLabel([{ source: "aria-label", text: "   " }, { source: "title", text: "T" }]), { label: "T", source: "title" });
  assert.deepEqual(pickLabel([]), { label: "", source: "none" });
});

// Minimal fake DOM: just the methods collectLabelCandidates uses.
function fakeEl(attrs = {}, extra = {}) {
  return { getAttribute: (k) => attrs[k] ?? null, id: attrs.id, ownerDocument: extra.doc, labels: extra.labels, closest: () => extra.wrap ?? null, previousElementSibling: extra.prev ?? null };
}

test("collects from aria-labelledby, label[for], wrapping label, sibling and name", () => {
  const doc = {
    getElementById: (id) => ({ a1: { textContent: "Applicant" }, a2: { textContent: "mobile" } }[id]),
    querySelector: (sel) => (sel === 'label[for="f1"]' ? { textContent: "Mobile number" } : null),
  };
  const el = fakeEl({ "aria-labelledby": "a1 a2", id: "f1", name: "mob" }, { doc, wrap: { textContent: "wrap" }, prev: { textContent: "Prev" } });
  const c = collectLabelCandidates(el);
  assert.deepEqual(c.map((x) => x.source), ["aria-labelledby", "label-for", "wrapping-label", "preceding-text", "name"]);
  assert.equal(labelFor(el).label, "Applicant mobile");
});

test("uses el.labels when the browser provides it", () => {
  const el = fakeEl({ id: "x" }, { labels: [{ textContent: "Email" }, { textContent: "address" }] });
  assert.deepEqual(labelFor(el), { label: "Email address", source: "label-for" });
});

test("tolerates non-elements", () => {
  assert.deepEqual(collectLabelCandidates(null), []);
  assert.deepEqual(labelFor({}), { label: "", source: "none" });
});
