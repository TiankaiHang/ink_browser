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
