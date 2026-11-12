import { readSettings, saveSettings, siteKey, applyMaterial, THEMES } from "./settings.js";
import { feishuPageMode } from "./site-theme.js";
let settings = await readSettings();
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const host = siteKey(tab?.url);
const siteButton = document.getElementById("site-toggle");
const status = document.getElementById("popup-status");
function paint() {
  applyMaterial(settings);
  for (const key of ["enabled", "webEnabled", "pdfEnabled"]) document.getElementById(key).checked = settings[key];
  document.querySelectorAll(".material").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.material === settings.material)));
  document.getElementById("material-name").textContent = settings.material === "paper" ? "深色纸张" : THEMES[settings.material].name;
  siteButton.disabled = !host;
  siteButton.textContent = settings.excludedHosts.includes(host) ? "恢复此网站" : "暂停此网站";
  document.getElementById("site").textContent = host || "阅读器与浏览器页面";
  document.getElementById("native-site-note").hidden = !feishuPageMode(tab?.url);
}
let busy = Promise.resolve();
function change(patch) {
  busy = busy.catch(() => {}).then(async () => {
    settings = await saveSettings(typeof patch === "function" ? patch(await readSettings()) : patch);
    paint();
    const result = await chrome.runtime.sendMessage({ type: "SYNC_RULES" });
    if (result.error) throw new Error(result.error);
    status.textContent = "已保存 · 已打开的 PDF 会同步切换外观";
  }).catch(error => { status.textContent = `保存失败：${error.message}`; });
}
for (const key of ["enabled", "webEnabled", "pdfEnabled"]) document.getElementById(key).addEventListener("change", event => change({ [key]: event.target.checked }));
document.querySelectorAll(".material").forEach(button => button.addEventListener("click", () => change({ material: button.dataset.material })));
siteButton.addEventListener("click", () => change(current => ({ excludedHosts: current.excludedHosts.includes(host) ? current.excludedHosts.filter(x => x !== host) : [...current.excludedHosts, host] })));
document.getElementById("open-reader").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") }));
document.getElementById("extension-settings").addEventListener("click", () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
document.getElementById("file-note").hidden = await chrome.extension.isAllowedFileSchemeAccess();
paint();
