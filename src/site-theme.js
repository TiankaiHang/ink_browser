export const FEISHU_NATIVE_EVENT = "ink:feishu-native-theme";

export function feishuPageMode(url) {
  try {
    const value = new URL(url);
    if (value.protocol !== "https:" || !(value.hostname === "feishu.cn" || value.hostname.endsWith(".feishu.cn"))) return null;
    if (/^\/drive(?:\/|$)/.test(value.pathname)) return "drive";
    if (/^\/(?:wiki|sheets|docx|docs|base|slides|mindnotes|file)(?:\/|$)/.test(value.pathname)) return "document";
    return null;
  } catch { return null; }
}

// Request native callbacks from the MAIN world; never inject a Feishu palette.
export function createFeishuNativeTheme(document) {
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
