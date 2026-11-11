export const MIN_SCALE = .35;
export const MAX_SCALE = 5;
export function clampScale(scale) { return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)); }
export function wheelScale(scale, event) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
  const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
  return clampScale(scale * Math.exp(-delta * .0025));
}
export function anchoredScroll(rect, anchor, scroll) {
  return {
    left: Math.max(0, scroll.x + rect.left + rect.width * anchor.x - anchor.clientX),
    top: Math.max(0, scroll.y + rect.top + rect.height * anchor.y - anchor.clientY)
  };
}
export function attachPdfZoom(target, { isEnabled, getScale, onZoom, onFit }) {
  const wheel = event => {
    if (!(event.ctrlKey || event.metaKey) || !isEnabled(event) || !event.deltaY) return;
    event.preventDefault();
    onZoom(wheelScale(getScale(), event), { clientX: event.clientX, clientY: event.clientY });
  };
  const key = event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !isEnabled(event)) return;
    if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "0") onFit();
      else onZoom(clampScale(getScale() * (event.key === "-" ? 1 / 1.2 : 1.2)));
    }
  };
  // The default window wheel listener is passive in Chromium. Explicitly opt out
  // so Ctrl-wheel / trackpad pinch scales the document, not the browser chrome.
  target.addEventListener("wheel", wheel, { passive: false });
  target.addEventListener("keydown", key);
  return () => { target.removeEventListener("wheel", wheel); target.removeEventListener("keydown", key); };
}
