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
