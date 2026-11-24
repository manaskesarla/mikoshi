// The agent loop. All I/O is injected so the whole loop runs under Node with fakes.
//
//   const run = createOrchestrator(deps);
//   const outcome = await run({ goal, mode });   // { status, summary?, reason?, steps }
//
// deps:
//   perceive()            -> { skeleton, pageText, hidden:[{text,style}], attributes:[string], pageOrigin }
//   vision(page)          -> { image: dataURL|null, verify: { ok, reason? } }   (screenshot + OCR + redact + recheck)
//   api(payload)          -> StepResponse   (throws on HTTP failure; err.status may be set)
//   execute(action, value)-> { ok, error?, navigated? }          value = real value resolved locally
//   readNodes(ids)        -> [string]                            text of nodes, for `extract`
//   approve(request)      -> "approve" | "deny" | "stop"
//   profile()             -> { category: value }                 autofill-enabled profile entries only
//   emit(event)           -> void
//   settings              -> { approvalMode: "risky"|"every", stepCap, wallClockMs, domOnlyIfOcrFails, maxBlocks, canaries, trustedOrigins }
//   onSend(payload)       -> void   called with the exact payload about to be sent (for the "what was sent" view)
//   now()                 -> ms
//   shouldStop()          -> boolean

import { Vault } from "../lib/tokenizer.mjs";
import { sanitizeSkeleton, sanitizeText, sanitizeTaskGoal } from "../lib/dlp-sanitizer.mjs";
import { scanAdversarialVectors } from "../lib/adversarial-guard.mjs";
import { classifyAction } from "../lib/action-firewall.mjs";
import { enforceEgress } from "./egress.js";
import { validatePlan } from "./response-validation.js";

const DEFAULTS = { approvalMode: "risky", stepCap: 12, wallClockMs: 180000, domOnlyIfOcrFails: false, maxBlocks: 3, canaries: [], trustedOrigins: [] };
const SILENT = new Set(["wait", "scroll", "done", "ask_user", "extract"]);

export function createOrchestrator(deps) {
  const settings = { ...DEFAULTS, ...(deps.settings || {}) };
  const emit = (e) => deps.emit?.({ ts: deps.now(), ...e });

  return async function run({ goal, mode = "act" }) {
    const vault = new Vault();
    vault.addProfile(deps.profile?.() || {});
    const taskGoal = sanitizeTaskGoal(goal, vault).text;
    const started = deps.now();
    const history = [];
    const extracted = {};
    let blocks = 0;
    let idleSteps = 0;
    let lastSignature = "";
    let step = 0;

    const finish = (status, extra = {}) => {
      vault.forgetSource("screen"); vault.forgetSource("goal"); vault.forgetSource("egress");
      emit({ step, phase: "end", status, detail: extra.reason || extra.summary || "" });
      return { status, steps: step, ...extra };
    };
    const stop = (reason, phase, status = "blocked") => { emit({ step, phase, status: "blocked", detail: reason }); return finish(status, { reason }); };

    while (true) {
      if (deps.shouldStop?.()) return finish("stopped", { reason: "stopped by user" });
      if (step >= settings.stepCap) return finish("cap", { reason: `step limit of ${settings.stepCap} reached` });
      if (deps.now() - started > settings.wallClockMs) return finish("cap", { reason: "time limit reached" });
      step++;

      // 1. perceive + adversarial scan
      let page;
      try { page = await deps.perceive(); } catch (e) { return stop(`could not read the page (${e.message})`, "perceive", "failed"); }
      const scan = scanAdversarialVectors({ text: page.pageText, hidden: page.hidden, attributes: page.attributes });
      emit({ step, phase: "perceive", status: "ok", detail: `${page.skeleton.nodes.length} elements, page ${scan.verdict}` });

      // 2. vision: screenshot -> redact -> recheck. Fail closed.
      let image = null;
      try {
        const v = await deps.vision(page);
        if (v.verify?.ok) image = v.image;
        else if (v.verify?.reason === "OCR_FAILED" && settings.domOnlyIfOcrFails) emit({ step, phase: "redact", status: "ok", detail: "OCR unavailable; continuing DOM-only (setting enabled)" });
        else return stop(v.verify?.reason || "redaction could not be verified", "verify");
      } catch (e) { return stop(`redaction failed (${e.message})`, "verify"); }
      emit({ step, phase: "verify", status: "ok", detail: image ? "screenshot redacted and rechecked" : "no screenshot sent" });

      // 3. sanitize everything that will leave
      const { skeleton, counts } = sanitizeSkeleton(page.skeleton, vault);
      const sanitizedHistory = history.map((h) => JSON.parse(sanitizeText(JSON.stringify(h), vault).text));
      const cleanExtracted = Object.fromEntries(Object.entries(extracted).map(([k, t]) => [k, sanitizeText(t, vault).text]));
      const payload = { taskGoal, mode, step, skeleton, screenshot: image, history: sanitizedHistory, extracted: cleanExtracted, vaultContext: vault.exportContext() };

      // 4. egress policy over the exact bytes
      const egress = enforceEgress(payload, { vault, canaries: settings.canaries });
      if (egress.action === "block") return stop(`outgoing data blocked: ${egress.result.reasons.join("; ")}`, "egress");
      if (egress.action === "approve") {
        const answer = await deps.approve({ kind: "egress", reasons: egress.result.reasons, risk: "HIGH" });
        if (answer !== "approve") return finish(answer === "stop" ? "stopped" : "blocked", { reason: "you declined to send this data" });
      }
      deps.onSend?.(egress.payload);
      emit({ step, phase: "egress", status: "ok", counts, detail: `${egress.result.decision.toLowerCase()}, ${JSON.stringify(egress.payload).length} bytes` });

      // 5. ask the model
      let response;
      try { response = await deps.api(egress.payload); }
      catch (e) { return stop(e.status === 503 ? "the AI service is unavailable" : `the AI service failed (${e.message})`, "plan", "failed"); }

      // 6. never trust the plan
      const plan = validatePlan(response, { skeleton: page.skeleton, vault, mode });
      if (!plan.ok) return stop(`rejected the AI's plan: ${plan.reason}`, "plan", "failed");
      emit({ step, phase: "plan", status: "ok", detail: response.rationale || `${plan.actions.length} action(s)` });

      const signature = JSON.stringify(plan.actions.map((a) => [a.action, a.targetId, a.fillToken, a.url, a.query]));
      if (signature === lastSignature && !plan.actions.every((a) => SILENT.has(a.action))) return stop("the AI repeated the same plan", "plan", "failed");
      lastSignature = signature;

      // 7. firewall -> approval -> execute, one action at a time
      let progressed = false;
      for (const a of plan.actions) {
        if (deps.shouldStop?.()) return finish("stopped", { reason: "stopped by user" });
        const node = page.skeleton.nodes.find((n) => n.id === a.targetId) || {};
        const value = a.fillToken ? vault.resolve(a.fillToken) : a.literalValue;     // real value stays local
        const verdict = classifyAction(a, { targetNode: node, resolvedValue: value, pageOrigin: page.pageOrigin, pageMalicious: scan.verdict === "MALICIOUS", mode, trustedOrigins: settings.trustedOrigins });
        const label = { action: a.action, targetId: a.targetId, fillToken: a.fillToken, url: a.url ? sanitizeText(a.url, vault).text : undefined };

        if (a.action === "done") return finish("done", { summary: resolveLocally(response.summary ?? "Done.", vault) });
        if (verdict.decision === "BLOCK") {
          blocks++; history.push({ step, action: label, result: { ok: false, blocked: true } });
          emit({ step, phase: "firewall", status: "blocked", detail: `${a.action}: ${verdict.reasons.join("; ")}` });
          if (blocks >= settings.maxBlocks) return stop("too many blocked actions", "firewall");
          continue;
        }
        const needsAsk = verdict.decision === "REQUIRE_APPROVAL" || (settings.approvalMode === "every" && !SILENT.has(a.action));
        if (needsAsk) {
          emit({ step, phase: "firewall", status: "needs_approval", detail: `${a.action}: ${verdict.reasons.join("; ") || "approval mode"}` });
          const answer = await deps.approve({ kind: "action", action: label, risk: verdict.risk, reasons: verdict.reasons, preview: a.fillToken ? vault.maskForDisplay(a.fillToken) : undefined });
          if (answer === "stop") return finish("stopped", { reason: "stopped by user" });
          if (answer !== "approve") { history.push({ step, action: label, result: { ok: false, denied: true } }); emit({ step, phase: "firewall", status: "denied", detail: a.action }); continue; }
        }

        if (a.action === "extract") {
          const texts = await deps.readNodes(a.targetIds);
          extracted[a.name] = texts.join(" ").slice(0, 2000);
          history.push({ step, action: { action: "extract", name: a.name }, result: { ok: true } });
          emit({ step, phase: "execute", status: "ok", detail: `extracted ${a.name}` });
          progressed = true;
          continue;
        }
        if (a.action === "ask_user") {
          const answer = await deps.approve({ kind: "question", question: sanitizeText(a.question, vault).text });
          history.push({ step, action: { action: "ask_user" }, result: { ok: true, answer: answer === "approve" ? "continue" : "stop" } });
          if (answer !== "approve") return finish("stopped", { reason: "no answer given" });
          progressed = true;
          continue;
        }

        const res = await deps.execute(a, value);
        history.push({ step, action: label, result: { ok: !!res.ok, error: res.error ? String(res.error).slice(0, 80) : undefined } });
        emit({ step, phase: "execute", status: res.ok ? "ok" : "failed", detail: `${a.action}${a.targetId ? ` ${a.targetId}` : ""}${a.fillToken ? ` ${a.fillToken}` : ""}` });
        if (res.ok) progressed = true;
        if (res.navigated) break; // page changed: re-perceive
      }

      if (response.done) return finish("done", { summary: resolveLocally(response.summary ?? "Done.", vault) });
      // one fruitless step is normal (the model sees the block/failure in `history` and can adapt); two in a row is stuck
      idleSteps = progressed ? 0 : idleSteps + 1;
      if (idleSteps >= 2) return stop("no action made progress", "execute", "failed");
    }
  };
}

/** Put real values back into text, locally, for display to the user only. */
export function resolveLocally(text, vault) {
  return String(text).replace(/\[[A-Z0-9]+_\d+\]/g, (t) => vault.resolve(t) ?? t);
}
