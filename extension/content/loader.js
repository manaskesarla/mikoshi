// Classic script injected on demand. Loads the real content code as ES modules.
(() => {
  if (window.__mikoshiLoaded) return;
  window.__mikoshiLoaded = true;
  import(chrome.runtime.getURL("content/main.mjs")).catch((e) => { window.__mikoshiLoaded = false; console.warn("Mikoshi: could not load page code", e); });
})();
