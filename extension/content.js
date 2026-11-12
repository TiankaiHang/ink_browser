{
const DEFAULTS = Object.freeze({ enabled: true, webEnabled: true, pdfEnabled: true, material: "paper", excludedHosts: [] });
const THEMES = Object.freeze({
  black: { name: "纯黑", background: "#000000", foreground: "#e8e8e8", surface: "#111111" },
  frost: { name: "磨砂", background: "#181e23", foreground: "#e0e6eb", surface: "#222a31" },
  paper: { name: "纸张", background: "#20211e", foreground: "#e5e1d6", surface: "#2a2b26" }
});
function normalizeSettings(value = {}) {
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULTS.enabled,
    webEnabled: typeof value.webEnabled === "boolean" ? value.webEnabled : DEFAULTS.webEnabled,
    pdfEnabled: typeof value.pdfEnabled === "boolean" ? value.pdfEnabled : DEFAULTS.pdfEnabled,
    material: Object.hasOwn(THEMES, value.material) ? value.material : DEFAULTS.material,
    excludedHosts: Array.isArray(value.excludedHosts) ? [...new Set(value.excludedHosts.filter(x => typeof x === "string" && /^[a-z0-9.:[\]-]+$/i.test(x)).map(x => x.toLowerCase()))] : []
  };
}
function siteKey(url) {
  try { const u = new URL(url); return /^(https?|file):$/.test(u.protocol) ? u.hostname.toLowerCase() : ""; } catch { return ""; }
}
function isExcluded(url, settings) { const key = siteKey(url); return Boolean(key && settings.excludedHosts.includes(key)); }
function pdfSource(value) {
  try {
    const u = new URL(value);
    return /^(https?|file):$/.test(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
function viewerUrl(base, source) {
  const safe = pdfSource(source);
  if (!safe) throw new Error("仅支持 HTTP、HTTPS 和本地文件地址");
  const u = new URL(safe);
  const hash = u.hash;
  u.hash = "";
  return `${base}?file=${encodeURIComponent(u.href)}${hash}`;
}
function sourceFromViewer(location) {
  const query = location.search;
  // DNR cannot URL-encode its substitution. Preserve the complete raw URL,
  // including ampersands and percent signs, rather than parsing it as parameters.
  return query.startsWith("?source:") ? pdfSource(query.slice(8)) : pdfSource(new URLSearchParams(query).get("file"));
}
async function readSettings() { return normalizeSettings((await chrome.storage.local.get("settings")).settings); }
async function saveSettings(patch) {
  const value = normalizeSettings({ ...await readSettings(), ...patch });
  await chrome.storage.local.set({ settings: value });
  return value;
}
function applyMaterial(settings) {
  const theme = THEMES[settings.material];
  document.documentElement.dataset.material = settings.material;
  document.documentElement.style.setProperty("--paper", theme.background);
  document.documentElement.style.setProperty("--ink", theme.foreground);
  document.documentElement.style.setProperty("--surface", theme.surface);
}

function isFeishuDrive(url) {
  try {
    const value = new URL(url);
    return value.protocol === "https:" && (value.hostname === "feishu.cn" || value.hostname.endsWith(".feishu.cn")) && /^\/drive(?:\/|$)/.test(value.pathname);
  } catch { return false; }
}

function mixColor(background, foreground, amount) {
  const channel = (color, index) => parseInt(color.slice(index, index + 2), 16);
  return "#" + [1, 3, 5].map(index => Math.round(channel(background, index) * (1 - amount) + channel(foreground, index) * amount).toString(16).padStart(2, "0")).join("");
}

function feishuMaterialCSS(theme) {
  const muted = mixColor(theme.background, theme.foreground, .7);
  const faint = mixColor(theme.background, theme.foreground, .48);
  const border = mixColor(theme.background, theme.foreground, .18);
  const hover = mixColor(theme.background, theme.foreground, .08);
  const active = mixColor(theme.background, theme.foreground, .13);
  // Feishu declares these tokens on .ccm-scope, not :root. Override the same
  // scope so dynamically inserted theme styles cannot leave white surfaces.
  const tokens = {
    "bg-base": theme.background, "bg-body": theme.background,
    "bg-body-overlay": theme.surface, "bg-content-base": theme.background,
    "bg-float": theme.surface, "bg-float-base": theme.background,
    "bg-float-overlay": theme.surface, "bg-sub-navigation": theme.surface,
    "bg-filler": theme.surface, "bg-tips": theme.surface,
    "text-title": theme.foreground, "text-caption": muted,
    "text-placeholder": faint, "text-disabled": faint,
    "icon-n1": theme.foreground, "icon-n2": muted, "icon-n3": faint,
    "line-border-card": border, "line-border-component": border,
    "line-divider-default": border, "line-divider-module": border,
    "fill-hover": hover, "fill-pressed": active, "fill-active": active
  };
  return `html[data-ink-material] .ccm-scope {
    color-scheme: dark;
    ${Object.entries(tokens).map(([name, value]) => `--${name}: ${value} !important;`).join("\n    ")}
  }`;
}

function createFeishuNativeTheme(document) {
  let active = false;
  let previousTheme;
  let style;
  let observer;
  function ensureDark() {
    const root = document.documentElement;
    if (active && root.getAttribute("data-theme") !== "dark") {
      // Preserve an in-page theme change so disabling Ink restores the latest
      // site preference. No cookie, localStorage, or server setting is changed.
      previousTheme = root.getAttribute("data-theme");
      root.setAttribute("data-theme", "dark");
    }
  }
  return {
    enable(theme) {
      const root = document.documentElement;
      if (!active) {
        previousTheme = root.getAttribute("data-theme");
        active = true;
        root.setAttribute("data-theme", "dark");
        observer = new document.defaultView.MutationObserver(ensureDark);
        observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
      }
      if (!style?.isConnected) {
        style = document.createElement("style");
        style.dataset.inkSiteTheme = "feishu";
        (document.head || root).append(style);
      }
      style.textContent = feishuMaterialCSS(theme);
      ensureDark();
    },
    disable() {
      if (!active) return;
      active = false;
      observer?.disconnect();
      observer = null;
      style?.remove();
      style = null;
      if (previousTheme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", previousTheme);
    }
  };
}

// Shared settings and site adapters are prepended in the isolated world.
(() => {
  if (!globalThis.chrome?.runtime?.id || document.documentElement?.dataset.inkContent) return;
  let style;
  let state;
  let observer;
  const reader = chrome.runtime.getURL("viewer.html");
  const texture = chrome.runtime.getURL("assets/paper.svg");
  const embedded = new Map();
  const feishuTheme = createFeishuNativeTheme(document);
  DarkReader.setFetchMethod(async url => {
    const result = await chrome.runtime.sendMessage({ type: "FETCH_CSS", url });
    if (result.error) throw new Error(result.error);
    return new Response(result.text);
  });
  function updateEmbeds() {
    if (!state?.enabled || !state.pdfEnabled || isExcluded(location.href, state)) return;
    document.querySelectorAll('embed[type="application/pdf"],object[type="application/pdf"]').forEach(node => {
      const source = node.getAttribute("src") || node.getAttribute("data");
      if (!source) return;
      let url;
      try { url = new URL(source, document.baseURI).href; } catch { return; }
      if (!pdfSource(url)) return;
      const frame = document.createElement("iframe");
      frame.src = viewerUrl(reader, url);
      frame.title = "墨阅 PDF 阅读器";
      frame.style.cssText = node.style.cssText;
      frame.style.border = "0";
      frame.width = node.getAttribute("width") || "100%";
      frame.height = node.getAttribute("height") || "600";
      node.replaceWith(frame);
      embedded.set(frame, node);
    });
  }
  async function apply() {
    state = await readSettings();
    if (document.contentType === "application/pdf") {
      if (state.enabled && state.pdfEnabled && !isExcluded(location.href, state) && !new URL(location.href).searchParams.has("ink-original")) {
        chrome.runtime.sendMessage({ type: "OPEN_PDF", url: location.href }).catch(() => {});
      }
      return;
    }
    if (!document.documentElement) return;
    style?.remove();
    document.documentElement.removeAttribute("data-ink-material");
    document.body?.classList.remove("ink-paper-surface");
    if (state.enabled && state.webEnabled && !isExcluded(location.href, state)) {
      const theme = THEMES[state.material];
      if (isFeishuDrive(location.href)) {
        // Feishu has a complete native dark palette. Running a second engine
        // over it can recolor text while missing dynamic background tokens.
        DarkReader.disable();
        feishuTheme.enable(theme);
      } else {
        feishuTheme.disable();
        DarkReader.enable({ darkSchemeBackgroundColor: theme.background, darkSchemeTextColor: theme.foreground, scrollbarColor: "auto", selectionColor: "auto" }, { ignoreImageAnalysis: ["*"], disableStyleSheetsProxy: true });
      }
      document.documentElement.dataset.inkMaterial = state.material;
      if (document.body && getComputedStyle(document.body).backgroundImage === "none") document.body.classList.add("ink-paper-surface");
      style = document.createElement("style");
      style.textContent = `html[data-ink-material="paper"] body.ink-paper-surface { background-image: url("${texture}") !important; background-repeat: repeat !important; background-size: 180px 180px !important; }
        html[data-ink-material="frost"] body.ink-paper-surface { background-image: radial-gradient(ellipse at 10% 0%, rgba(130,155,180,.07), transparent 65%) !important; }`;
      (document.head || document.documentElement).append(style);
    } else {
      feishuTheme.disable();
      DarkReader.disable();
    }
    if (!state.enabled || !state.pdfEnabled || isExcluded(location.href, state)) {
      for (const [frame, node] of embedded) frame.replaceWith(node);
      embedded.clear();
    } else updateEmbeds();
  }
  // Serialize updates so a slower storage read cannot restore stale settings.
  let pending = Promise.resolve();
  const refresh = () => { pending = pending.catch(() => {}).then(apply); pending.catch(console.error); };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.settings) refresh(); });
  refresh();
  document.addEventListener("DOMContentLoaded", () => {
    refresh();
    observer = new MutationObserver(updateEmbeds);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }, { once: true });
})();

}
