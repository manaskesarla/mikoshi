// Screenshot -> redact -> recheck. DOM-only until the OCR assets are installed.
// Contract (used by the orchestrator): returns { image: dataURL|null, verify: { ok, reason? } }.
export function makeVision(settings, taskRef) {
  return async function vision(_page) {
    if (!settings.useScreenshot) return { image: null, verify: { ok: true } };       // nothing image-shaped leaves the machine
    throw new Error("screenshot mode needs the OCR assets (run `npm run fetch:vendor`)");
  };
}
