// Action Firewall: classify every action the model proposes BEFORE it touches the page.
//   classifyAction(action, ctx) -> { risk: LOW|MEDIUM|HIGH|CRITICAL,
//                                    decision: ALLOW|REQUIRE_APPROVAL|BLOCK,
//                                    reasons: string[],   // never raw values
//                                    exfil: null | { channel, categories } }
// action: { action, targetId?, url?, query?, literalValue?, fillToken?, piiCategory? }
// ctx:    { targetNode?, resolvedValue?, pageOrigin?, pageMalicious?, destinationTrust?, mode? ("act"|"read_only") }
// Least privilege: unknown actions are blocked.

import { detectPII } from "./pii-rules.mjs";
import { scanSecrets } from "./secret-scanner.mjs";
import { isRestrictedCategory } from "./sensitive-fields.mjs";
import { urlRisk } from "./url-risk.mjs";

const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const EXECUTABLE = /\.(exe|scr|bat|cmd|com|msi|dll|ps1|vbs|jar|apk|dmg|pkg|app|deb|rpm|sh|run)(?:[?#]|$)/i;
const PAYMENT = /\b(pay|payment|checkout|purchase|buy\s+now|place\s+order|donate|transfer|send\s+money|confirm\s+(?:payment|order))\b/i;
const DESTRUCTIVE = /\b(delete|remove|close\s+account|deactivate|wipe|erase|permanently)\b/i;
const SECURITY_SETTING = /\b(change\s+password|security\s+settings|2fa|two-factor|recovery\s+(?:email|phone)|api\s+key|disable\s+security|trusted\s+devices?)\b/i;
const CREDENTIAL_FIELD = /password|api[_-]?key|token|secret/i;
const MUTATING = new Set(["type", "select", "submit", "upload", "download", "paste"]);
const NON_MUTATING = new Set(["wait", "scroll", "done", "ask_user", "extract"]);
const APPROVAL_EVEN_AT_MEDIUM = new Set(["submit", "upload", "download"]);

function sensitivity(text) {
  const s = typeof text === "string" ? text : "";
  if (!s) return { pii: [], secrets: [], restricted: false };
  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch { /* keep raw */ }
  const pii = [...new Set(detectPII(decoded, { minConfidence: 0.5 }).map((h) => h.category))];
  const secrets = [...new Set(scanSecrets(decoded, { minConfidence: 0.5 }).map((x) => x.subtype))];
  return { pii, secrets, restricted: pii.some(isRestrictedCategory) };
}
const host = (u) => { try { return new URL(u).host; } catch { return String(u || "").slice(0, 40); } };
const offOrigin = (u, origin) => { if (!u || !origin) return false; try { return new URL(u).origin !== origin; } catch { return false; } };

export function classifyAction(action, ctx = {}) {
  const a = action || {};
  const node = ctx.targetNode || {};
  const reasons = [];
  let risk = "LOW";
  let exfil = null;
  const bump = (r, why) => { if (RANK[r] > RANK[risk]) risk = r; if (why) reasons.push(why); };
  const done = () => {
    const decision = risk === "CRITICAL" ? "BLOCK"
      : risk === "HIGH" ? "REQUIRE_APPROVAL"
      : risk === "MEDIUM" && APPROVAL_EVEN_AT_MEDIUM.has(a.action) ? "REQUIRE_APPROVAL"
      : "ALLOW";
    return { risk, decision, reasons, exfil };
  };

  if (ctx.mode === "read_only" && (MUTATING.has(a.action) || (a.action === "click" && node.isSubmit))) {
    return { risk: "CRITICAL", decision: "BLOCK", reasons: ["read-only mode forbids actions that change the page or send data"], exfil: null };
  }
  if (NON_MUTATING.has(a.action)) return { risk: "LOW", decision: "ALLOW", reasons: ["non-mutating action"], exfil: null };

  const nodeText = String(node.text || node.label || "");
  const nodeSensitive = Boolean(node.isCensored) || isRestrictedCategory(node.piiCategory) || /password|otp|cvv|card|aadhaar|ssn|\bpan\b/i.test(`${nodeText} ${node.name || ""}`);

  switch (a.action) {
    case "type":
    case "select": {
      const v = sensitivity(ctx.resolvedValue ?? a.literalValue);
      if (v.secrets.length) bump("HIGH", `typing credential material (${v.secrets.join(", ")})`);
      else if (v.restricted) bump("MEDIUM", `typing restricted personal data (${v.pii.join(", ")})`);
      else if (v.pii.length) bump("MEDIUM", `typing personal data (${v.pii.join(", ")})`);
      else if (nodeSensitive) bump("MEDIUM", "filling a sensitive field");
      if ((v.pii.length || v.secrets.length || nodeSensitive) && node.formCrossOrigin) {
        exfil = { channel: "cross_origin_form", categories: [...v.pii, ...v.secrets] };
        bump("CRITICAL", `sensitive value into a form that submits to ${host(node.formOrigin)} (a different site)`);
      }
      break;
    }
    case "submit": {
      bump("MEDIUM", "form submission");
      if (nodeSensitive || CREDENTIAL_FIELD.test(`${node.name || ""} ${nodeText}`)) bump("HIGH", "submitting a form with credential or restricted fields");
      if (node.formCrossOrigin) {
        exfil = { channel: "cross_origin_form_submit", categories: ["form-data"] };
        bump("CRITICAL", `form submits to ${host(node.formOrigin)} (a different site)`);
      }
      if (PAYMENT.test(nodeText)) bump("HIGH", "payment or money-movement control");
      break;
    }
    case "click": {
      const href = node.href;
      if (href) {
        const off = offOrigin(href, ctx.pageOrigin);
        const us = sensitivity(href);
        if (node.downloadAttr || EXECUTABLE.test(href)) {
          bump("HIGH", "triggers a file download");
          if (EXECUTABLE.test(href)) bump("CRITICAL", "download is an executable file");
        } else if (off) bump("MEDIUM", `navigates to another site (${host(href)})`);
        if (off && (ctx.destinationTrust ?? urlRisk(href, { pageOrigin: ctx.pageOrigin }).trust) < 0.4) bump("HIGH", `low-trust destination ${host(href)}`);
        if (us.pii.length || us.secrets.length) {
          exfil = { channel: "url", categories: [...us.pii, ...us.secrets] };
          bump("CRITICAL", `the link carries ${[...us.pii, ...us.secrets].join(", ")} to ${host(href)}`);
        }
      }
      if (PAYMENT.test(nodeText)) bump("HIGH", "payment or money-movement control");
      if (DESTRUCTIVE.test(nodeText)) bump("HIGH", "destructive action (delete / deactivate)");
      if (SECURITY_SETTING.test(nodeText)) bump("HIGH", "changes a security or account setting");
      if (node.isSubmit && nodeSensitive) bump("HIGH", "submit button on a sensitive form");
      break;
    }
    case "navigate":
    case "open_tab": {
      const url = a.url ?? a.literalValue;
      const us = sensitivity(url);
      const trust = ctx.destinationTrust ?? urlRisk(url, { pageOrigin: ctx.pageOrigin }).trust;
      bump("MEDIUM", "navigation");
      if (offOrigin(url, ctx.pageOrigin)) bump("HIGH", `navigates off-site (${host(url)})`);
      if (trust < 0.3) bump("CRITICAL", `destination ${host(url)} has a very low trust score`);
      else if (trust < 0.5) bump("HIGH", `destination ${host(url)} has a low trust score`);
      if (us.pii.length || us.secrets.length) {
        exfil = { channel: "navigate_url", categories: [...us.pii, ...us.secrets] };
        bump("CRITICAL", "the URL carries sensitive data");
      }
      break;
    }
    case "search": {
      const q = sensitivity(a.query ?? a.literalValue);
      bump("MEDIUM", "search query leaves the page");
      if (q.pii.length || q.secrets.length) {
        exfil = { channel: "search_query", categories: [...q.pii, ...q.secrets] };
        bump("CRITICAL", `the query contains ${[...q.pii, ...q.secrets].join(", ")}`);
      }
      break;
    }
    case "download": bump("HIGH", "file download"); if (EXECUTABLE.test(a.url || a.literalValue || "")) bump("CRITICAL", "executable download"); break;
    case "upload": bump("HIGH", "file upload"); break;
    case "copy": case "paste": bump("HIGH", "clipboard access"); break;
    case "execute_script": bump("CRITICAL", "arbitrary script execution"); break;
    default: bump("CRITICAL", `unrecognised action "${String(a.action).slice(0, 30)}"`);
  }

  if (ctx.pageMalicious && (MUTATING.has(a.action) || ["click", "navigate", "open_tab", "search"].includes(a.action))) {
    bump("HIGH", "the page contains prompt-injection content trying to steer the agent");
  }
  return done();
}

export default { classifyAction };
