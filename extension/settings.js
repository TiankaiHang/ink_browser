export const DEFAULTS = Object.freeze({ enabled: true, webEnabled: true, pdfEnabled: true, material: "paper", excludedHosts: [] });
export const THEMES = Object.freeze({
  black: { name: "纯黑", background: "#000000", foreground: "#e8e8e8", surface: "#111111" },
  frost: { name: "磨砂", background: "#181e23", foreground: "#e0e6eb", surface: "#222a31" },
  paper: { name: "纸张", background: "#20211e", foreground: "#e5e1d6", surface: "#2a2b26" }
});
export function normalizeSettings(value = {}) {
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULTS.enabled,
    webEnabled: typeof value.webEnabled === "boolean" ? value.webEnabled : DEFAULTS.webEnabled,
    pdfEnabled: typeof value.pdfEnabled === "boolean" ? value.pdfEnabled : DEFAULTS.pdfEnabled,
    material: Object.hasOwn(THEMES, value.material) ? value.material : DEFAULTS.material,
    excludedHosts: Array.isArray(value.excludedHosts) ? [...new Set(value.excludedHosts.filter(x => typeof x === "string" && /^[a-z0-9.:[\]-]+$/i.test(x)).map(x => x.toLowerCase()))] : []
  };
}
export function siteKey(url) {
  try { const u = new URL(url); return /^(https?|file):$/.test(u.protocol) ? u.hostname.toLowerCase() : ""; } catch { return ""; }
}
export function isExcluded(url, settings) { const key = siteKey(url); return Boolean(key && settings.excludedHosts.includes(key)); }
export function pdfSource(value) {
  try {
    const u = new URL(value);
    return /^(https?|file):$/.test(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
export function viewerUrl(base, source) {
  const safe = pdfSource(source);
  if (!safe) throw new Error("仅支持 HTTP、HTTPS 和本地文件地址");
  const u = new URL(safe);
  const hash = u.hash;
  u.hash = "";
  return `${base}?file=${encodeURIComponent(u.href)}${hash}`;
}
export function sourceFromViewer(location) {
  const query = location.search;
  // DNR cannot URL-encode its substitution. Preserve the complete raw URL,
  // including ampersands and percent signs, rather than parsing it as parameters.
  return query.startsWith("?source:") ? pdfSource(query.slice(8)) : pdfSource(new URLSearchParams(query).get("file"));
}
export async function readSettings() { return normalizeSettings((await chrome.storage.local.get("settings")).settings); }
export async function saveSettings(patch) {
  const value = normalizeSettings({ ...await readSettings(), ...patch });
  await chrome.storage.local.set({ settings: value });
  return value;
}
export function applyMaterial(settings) {
  const theme = THEMES[settings.material];
  document.documentElement.dataset.material = settings.material;
  document.documentElement.style.setProperty("--paper", theme.background);
  document.documentElement.style.setProperty("--ink", theme.foreground);
  document.documentElement.style.setProperty("--surface", theme.surface);
}
