// Destination trust score for a URL the agent might open, follow or send data to.
//   urlRisk(url, ctx) -> { trust: 0..1, reasons: string[] }
// ctx: { pageOrigin?: string, trustedOrigins?: string[] }

const RISKY_TLDS = new Set(["zip", "mov", "tk", "ml", "ga", "cf", "gq", "xyz", "top", "click", "country", "kim"]);
const clamp = (n) => Math.max(0, Math.min(1, n));

function isIpLiteral(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}
function isLoopback(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

export function urlRisk(url, ctx = {}) {
  const { pageOrigin = null, trustedOrigins = [] } = ctx;
  let u;
  try { u = new URL(String(url)); } catch { return { trust: 0, reasons: ["not a valid absolute URL"] }; }

  if (u.protocol !== "https:" && u.protocol !== "http:") return { trust: 0, reasons: [`non-web scheme ${u.protocol}`] };
  if (trustedOrigins.includes(u.origin)) return { trust: 1, reasons: ["user-trusted site"] };

  const reasons = [];
  const host = u.hostname.toLowerCase();
  let trust = 0.8;

  if (isLoopback(host)) {
    trust = 0.9;
    reasons.push("local address");
  } else {
    if (u.protocol === "http:") { trust -= 0.3; reasons.push("unencrypted http"); }
    if (isIpLiteral(host)) { trust -= 0.3; reasons.push("IP address instead of a domain"); }
    if (host.split(".").some((l) => l.startsWith("xn--"))) { trust -= 0.3; reasons.push("punycode (possible look-alike) domain"); }
    const tld = host.split(".").pop();
    if (RISKY_TLDS.has(tld)) { trust -= 0.2; reasons.push(`frequently abused TLD .${tld}`); }
    if (host.split(".").length > 5) { trust -= 0.1; reasons.push("unusually many subdomains"); }
    if (host.length > 60) { trust -= 0.1; reasons.push("very long hostname"); }
  }
  if (u.username || u.password) { trust -= 0.4; reasons.push("credentials embedded in URL"); }
  if (pageOrigin && u.origin === pageOrigin) { trust += 0.1; reasons.push("same site as current page"); }
  return { trust: Math.round(clamp(trust) * 100) / 100, reasons };
}

export default { urlRisk };
