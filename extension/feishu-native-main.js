(() => {
"use strict";
const FEISHU_NATIVE_EVENT = "ink:feishu-native-theme";

function feishuPageMode(url) {
  try {
    const value = new URL(url);
    if (value.protocol !== "https:" || !(value.hostname === "feishu.cn" || value.hostname.endsWith(".feishu.cn"))) return null;
    if (/^\/drive(?:\/|$)/.test(value.pathname)) return "drive";
    if (/^\/(?:wiki|sheets|docx|docs|base|slides|mindnotes|file)(?:\/|$)/.test(value.pathname)) return "document";
    return null;
  } catch { return null; }
}

// Request native callbacks from the MAIN world; never inject a Feishu palette.
function createFeishuNativeTheme(document) {
  let active = false;
  const notify = () => document.dispatchEvent(new document.defaultView.CustomEvent(FEISHU_NATIVE_EVENT));
  return {
    enable() {
      active = true;
      document.documentElement.setAttribute("data-ink-feishu-native", "enabled");
      notify();
    },
    disable() {
      if (!active) return;
      active = false;
      document.documentElement.removeAttribute("data-ink-feishu-native");
      notify();
    }
  };
}

function nativeThemeName(value, fallback) {
  const theme = String(value || "").toLowerCase();
  return theme === "light" || theme === "dark" ? theme : fallback;
}

function createNativeThemeController({ window, document, schedule = setTimeout, cancel = clearTimeout, maxAttempts = 100 }) {
  let enabled = false;
  let attempts = 0;
  let timer;
  let original;
  let applied = false;
  const setStatus = value => {
    if (value) document.documentElement?.setAttribute("data-ink-feishu-native-status", value);
    else document.documentElement?.removeAttribute("data-ink-feishu-native-status");
  };
  function stopWaiting() { if (timer !== undefined) cancel(timer); timer = undefined; }
  function restore() {
    if (applied && original) {
      // Restore through native callbacks so both the sheet and toolbar update.
      // These callbacks do not persist an account-level appearance setting.
      try { window.switchContentUIState?.(original.content); } catch {}
      try { window.switchUIState?.({ mode: original.ui.toUpperCase(), vars: {} }); } catch {}
    }
    original = null;
    applied = false;
  }
  function apply() {
    if (!enabled) return;
    if (typeof window.switchUIState !== "function" || typeof window.switchContentUIState !== "function") {
      setStatus("pending");
      if (++attempts < maxAttempts) timer = schedule(apply, 100);
      else setStatus("unavailable");
      return;
    }
    if (!original) {
      const root = document.documentElement;
      const params = new URL(window.location.href).searchParams;
      const system = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      original = {
        ui: nativeThemeName(root.getAttribute("data-theme"), nativeThemeName(window.__theme__, system)),
        content: nativeThemeName(params.get("contentTheme"), root.getAttribute("data-lark-header") === "dark" ? "light" : "dark")
      };
    }
    try {
      applied = true;
      window.switchContentUIState("dark");
      window.switchUIState({ mode: "DARK", vars: {} });
      setStatus("applied");
    } catch {
      restore();
      setStatus("unavailable");
    }
  }
  return {
    request(value) {
      stopWaiting();
      enabled = value;
      attempts = 0;
      if (!enabled) { restore(); setStatus(null); return; }
      apply();
    }
  };
}

// Native-theme controller and route policy are prepended by the build.
(() => {
  const controller = createNativeThemeController({ window, document });
  const sync = () => controller.request(Boolean(feishuPageMode(location.href) && document.documentElement?.getAttribute("data-ink-feishu-native") === "enabled"));
  document.addEventListener(FEISHU_NATIVE_EVENT, sync);
  document.addEventListener("DOMContentLoaded", sync, { once: true });
  window.addEventListener("pagehide", () => controller.request(false));
  window.addEventListener("pageshow", sync);
  sync();
})();

})();
