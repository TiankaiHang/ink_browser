function nativeThemeName(value, fallback) {
  const theme = String(value || "").toLowerCase();
  return theme === "light" || theme === "dark" ? theme : fallback;
}

export function createNativeThemeController({ window, document, schedule = setTimeout, cancel = clearTimeout, maxAttempts = 100 }) {
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
