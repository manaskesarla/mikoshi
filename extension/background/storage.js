// Local storage only (chrome.storage.local). Nothing here is ever sent anywhere.
// Known limitation: values are stored unencrypted (see docs/13-open-questions.md, Q8).

export const DEFAULT_SETTINGS = {
  serverUrl: "http://127.0.0.1:8000", apiKey: "", approvalMode: "risky", stepCap: 12, wallClockMs: 180000,
  domOnlyIfOcrFails: false, useScreenshot: false, trustedOrigins: [],
};
const K = { version: "mikoshi:v", profile: "mikoshi:profile", settings: "mikoshi:settings", log: "mikoshi:log" };
const LOG_CAP = 500;

const get = async (key) => (await chrome.storage.local.get(key))[key];
const set = (key, value) => chrome.storage.local.set({ [key]: value });

export async function getSettings() { return { ...DEFAULT_SETTINGS, ...((await get(K.settings)) || {}) }; }
export async function saveSettings(patch) { const next = { ...(await getSettings()), ...patch }; await set(K.settings, next); return next; }

/** profile: { category: { value, autofill: boolean } } */
export async function getProfile() { return (await get(K.profile)) || {}; }
export async function saveProfile(profile) { await set(K.profile, profile); await set(K.version, 1); }
/** Only the entries the user allowed the agent to use: { category: value } */
export async function profileForAgent() {
  const p = await getProfile();
  return Object.fromEntries(Object.entries(p).filter(([, e]) => e && e.autofill !== false && e.value).map(([c, e]) => [c, e.value]));
}

export async function appendLog(event) {
  const log = ((await get(K.log)) || []).concat([event]);
  await set(K.log, log.slice(-LOG_CAP));
}
export async function getLog() { return (await get(K.log)) || []; }
export async function clearAll() { await chrome.storage.local.remove(Object.values(K)); }
