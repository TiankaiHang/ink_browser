export function feishuPageMode(url) {
  try {
    const value = new URL(url);
    if (value.protocol !== "https:" || !(value.hostname === "feishu.cn" || value.hostname.endsWith(".feishu.cn"))) return null;
    if (/^\/drive(?:\/|$)/.test(value.pathname)) return "drive";
    if (/^\/(?:wiki|sheets|docx|docs|base|slides|mindnotes|file)(?:\/|$)/.test(value.pathname)) return "document";
    return null;
  } catch { return null; }
}
export function isFeishuDrive(url) { return feishuPageMode(url) === "drive"; }

export function feishuDocumentCSS() {
  // Sheets bootstraps with an SVG snapshot before its native renderer starts.
  // Snapshot glyph colors are authored fills; changing only its backdrop makes
  // black glyphs unreadable. Keep this snapshot intact, then let Feishu redraw
  // the live sheet using its own coordinated UI/content theme settings.
  return `html[data-ink-material] #ssr-svg {
    background-color: #ffffff !important;
    color-scheme: light;
  }`;
}

function mixColor(background, foreground, amount) {
  const channel = (color, index) => parseInt(color.slice(index, index + 2), 16);
  return "#" + [1, 3, 5].map(index => Math.round(channel(background, index) * (1 - amount) + channel(foreground, index) * amount).toString(16).padStart(2, "0")).join("");
}

export function feishuMaterialCSS(theme) {
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

export function createFeishuNativeTheme(document) {
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
    enable(theme, { materialize = true } = {}) {
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
      // Spreadsheet cells, charts, and document canvases have their own theme
      // state. Never force UI background tokens into those render surfaces.
      style.textContent = materialize ? feishuMaterialCSS(theme) : feishuDocumentCSS();
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
