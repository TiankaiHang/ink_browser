import { readSettings, saveSettings, viewerUrl } from "./settings.js";
import { makePdfRules } from "./pdf-rules.js";

let queue = Promise.resolve();
function syncRules() {
  queue = queue.catch(() => {}).then(async () => {
    const settings = await readSettings();
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2, 3], addRules: makePdfRules(settings, chrome.runtime.getURL("viewer.html")) });
  });
  return queue;
}
chrome.runtime.onInstalled.addListener(() => { saveSettings({}).then(syncRules).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { syncRules().catch(console.error); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.settings) syncRules().catch(console.error); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "SYNC_RULES") {
    syncRules().then(() => respond({ ok: true }), error => respond({ error: error.message }));
    return true;
  }
  if (message?.type === "OPEN_PDF" && sender.tab && sender.frameId === 0) {
    (async () => {
      const settings = await readSettings();
      if (!settings.enabled || !settings.pdfEnabled) return;
      // A content script can only redirect the document it is running in.
      if (message.url !== sender.url) return;
      await chrome.tabs.update(sender.tab.id, { url: viewerUrl(chrome.runtime.getURL("viewer.html"), message.url) });
    })().then(() => respond({ ok: true }), error => respond({ error: error.message }));
    return true;
  }
  if (message?.type === "FETCH_CSS") {
    (async () => {
      const url = new URL(message.url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("不支持的样式地址");
      const response = await fetch(url.href, { credentials: "omit", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error("样式文件过大");
      return text;
    })().then(text => respond({ text }), error => respond({ error: error.message }));
    return true;
  }
});
syncRules().catch(console.error);
