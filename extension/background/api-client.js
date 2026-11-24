// The only module that talks to the Mikoshi server. Called only with a payload that
// has already passed the egress door (egress.js).
export async function postStep(payload, settings, fetchImpl = fetch) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  try {
    const headers = { "Content-Type": "application/json" };
    if (settings.apiKey) headers["X-Mikoshi-Key"] = settings.apiKey;
    const r = await fetchImpl(`${settings.serverUrl.replace(/\/+$/, "")}/agent/step`, { method: "POST", headers, body: JSON.stringify(payload), signal: ctl.signal });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json()).detail || ""; } catch { /* no body */ }
      const e = new Error(`HTTP ${r.status}${detail ? `: ${String(detail).slice(0, 120)}` : ""}`);
      e.status = r.status;
      throw e;
    }
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") { const t = new Error("the AI service timed out"); t.status = 503; throw t; }
    if (e.status === undefined) { const n = new Error("could not reach the Mikoshi server"); n.status = 503; throw n; }
    throw e;
  } finally { clearTimeout(timer); }
}

export async function checkHealth(settings, fetchImpl = fetch) {
  const r = await fetchImpl(`${settings.serverUrl.replace(/\/+$/, "")}/health`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
