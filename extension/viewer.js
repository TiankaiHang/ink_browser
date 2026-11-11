import { getDocument, GlobalWorkerOptions, TextLayer, PasswordResponses } from "./vendor/pdf.mjs";
import { readSettings, saveSettings, applyMaterial, THEMES, sourceFromViewer, pdfSource, isExcluded } from "./settings.js";
import { createPaperPattern } from "./paper.js";
import { attachPdfZoom, clampScale, anchoredScroll } from "./zoom.js";

GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;
const $ = id => document.getElementById(id);
let settings = await readSettings();
let pdf = null;
let loading = null;
let generation = 0;
let documentGeneration = 0;
let observer;
let currentPage = 1;
let zoom = "fit";
let raw = false;
let source = sourceFromViewer(location);
let filename = "document.pdf";
let queue = Promise.resolve();
let passwordCallback;
const tasks = new Set();
const visible = new Set();
let statusTimer;
let zoomFrame;
let zoomAnchor;
const pageDimensions = new Map();

function status(message, temporary = false) {
  clearTimeout(statusTimer);
  $("status").textContent = message;
  if (temporary) statusTimer = setTimeout(() => { $("status").textContent = ""; }, 6000);
}
function darkEnabled() { return settings.enabled && settings.pdfEnabled && !raw && !isExcluded(source, settings); }
function paint() {
  applyMaterial(settings);
  $("material").value = settings.material;
  $("original").textContent = raw ? "深色阅读" : "查看原色";
  $("original").setAttribute("aria-pressed", String(raw));
}
function setControls(enabled) {
  for (const id of ["page-number", "next", "previous", "zoom", "zoom-in", "zoom-out", "original", "download"]) $(id).disabled = !enabled;
  if (enabled) {
    $("previous").disabled = currentPage === 1;
    $("next").disabled = currentPage === pdf.numPages;
  }
}
function cancelRender() {
  generation++;
  observer?.disconnect();
  visible.clear();
  for (const task of tasks) task.cancel();
  tasks.clear();
  queue = Promise.resolve();
}
function viewportFor(page) {
  const base = page.getViewport({ scale: 1 });
  const available = Math.max(240, document.documentElement.clientWidth - 48);
  const scale = zoom === "fit" ? Math.min(available / base.width, 1.7) : zoom;
  return page.getViewport({ scale });
}
function pageSize(node, viewport) {
  pageDimensions.set(Number(node.dataset.page), { width: viewport.width / viewport.scale, height: viewport.height / viewport.scale });
  node.style.width = `${viewport.width}px`;
  node.style.height = `${viewport.height}px`;
  node.style.setProperty("--scale-factor", viewport.scale);
  node.style.setProperty("--total-scale-factor", viewport.scale);
  node.style.setProperty("--user-unit", viewport.userUnit || 1);
}
function placeholder(node) {
  node.replaceChildren();
  const label = document.createElement("div");
  label.className = "page-placeholder";
  label.textContent = `第 ${node.dataset.page} 页`;
  node.append(label);
  delete node.dataset.rendered;
}
async function renderPage(node, epoch) {
  if (epoch !== generation || !visible.has(node) || node.dataset.rendered) return;
  const activePdf = pdf;
  const page = await activePdf.getPage(Number(node.dataset.page));
  if (epoch !== generation) return;
  const viewport = viewportFor(page);
  pageSize(node, viewport);
  // Bound memory per canvas even on high-DPI screens or unusually large pages.
  const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width * ratio);
  canvas.height = Math.ceil(viewport.height * ratio);
  const theme = THEMES[settings.material];
  const dark = darkEnabled();
  const context = canvas.getContext("2d", { alpha: false });
  const inkTexture = dark && settings.material === "paper" ? createPaperPattern((width, height) => {
    const tile = document.createElement("canvas"); tile.width = width; tile.height = height; return tile;
  }, context, theme.background) : null;
  const task = page.render({
    canvasContext: context,
    viewport,
    transform: [ratio, 0, 0, ratio, 0, 0],
    background: dark ? inkTexture || theme.background : "#ffffff",
    pageColors: dark ? { foreground: theme.foreground, background: theme.background, ink: true, inkTexture } : null
  });
  tasks.add(task);
  try { await task.promise; } finally { tasks.delete(task); }
  if (epoch !== generation || !visible.has(node)) { canvas.width = canvas.height = 0; return; }
  node.replaceChildren(canvas);
  node.dataset.rendered = "true";
  const text = await page.getTextContent();
  if (epoch !== generation || !visible.has(node)) return;
  if (!text.items.some(item => item.str?.trim())) {
    if (dark) status("此页可能是扫描图片：已保留原色，扫描文字无法与图片分开改色。", true);
    return;
  }
  const container = document.createElement("div");
  container.className = "textLayer";
  node.append(container);
  const textLayer = new TextLayer({ textContentSource: text, container, viewport });
  tasks.add(textLayer);
  try { await textLayer.render(); } finally { tasks.delete(textLayer); }
}
function enqueue(node, epoch) {
  queue = queue.catch(() => {}).then(() => renderPage(node, epoch)).catch(error => {
    if (error.name === "RenderingCancelledException" || error.name === "AbortException" || epoch !== generation) return;
    console.error(error);
    const retry = document.createElement("button");
    retry.className = "page-placeholder";
    retry.textContent = `第 ${node.dataset.page} 页渲染失败，点击重试`;
    retry.addEventListener("click", () => { placeholder(node); enqueue(node, epoch); });
    node.replaceChildren(retry);
    status(`页面渲染失败：${error.message}`);
  });
}
async function layout(keepPage = true, anchor = null) {
  if (!pdf) return;
  cancelRender();
  const epoch = generation;
  const activePdf = pdf;
  const first = await activePdf.getPage(1);
  if (epoch !== generation) return;
  const viewport = viewportFor(first);
  const nodes = [];
  for (let number = 1; number <= activePdf.numPages; number++) {
    const node = document.createElement("article");
    node.className = "pdf-page";
    node.dataset.page = number;
    node.setAttribute("aria-label", `第 ${number} 页`);
    const dimension = pageDimensions.get(number);
    if (dimension) {
      const scale = zoom === "fit" ? Math.min(Math.max(240, document.documentElement.clientWidth - 48) / dimension.width, 1.7) : zoom;
      pageSize(node, { width: dimension.width * scale, height: dimension.height * scale, scale });
    } else pageSize(node, viewport);
    placeholder(node);
    nodes.push(node);
  }
  $("pages").replaceChildren(...nodes);
  $("pages").hidden = false;
  $("welcome").hidden = true;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const node = entry.target;
      if (entry.isIntersecting) { visible.add(node); enqueue(node, epoch); }
      else {
        visible.delete(node);
        node.querySelectorAll("canvas").forEach(canvas => { canvas.width = canvas.height = 0; });
        placeholder(node);
      }
    }
  }, { rootMargin: "900px 0px" });
  nodes.forEach(node => observer.observe(node));
  $("zoom").textContent = zoom === "fit" ? "适宽" : `${Math.round(zoom * 100)}%`;
  if (anchor) {
    const node = nodes[anchor.page - 1];
    if (node) {
      const position = anchoredScroll(node.getBoundingClientRect(), anchor, { x: scrollX, y: scrollY });
      window.scrollTo({ ...position, behavior: "instant" });
    }
  } else if (keepPage) jump(currentPage);
}
function jump(number) {
  currentPage = Math.max(1, Math.min(pdf?.numPages || 1, Number(number) || 1));
  const node = $("pages").children[currentPage - 1];
  if (node) window.scrollTo({ top: node.getBoundingClientRect().top + scrollY - 90, behavior: "instant" });
  $("page-number").value = currentPage;
  if (pdf) setControls(true);
  if (source) history.replaceState(null, "", `${location.pathname}${location.search}#page=${currentPage}`);
}
let scrollFrame;
window.addEventListener("scroll", () => {
  if (scrollFrame || !pdf) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    const near = [...visible].filter(node => node.getBoundingClientRect().bottom > 95).sort((a, b) => Number(a.dataset.page) - Number(b.dataset.page))[0];
    if (near) currentPage = Number(near.dataset.page);
    $("page-number").value = currentPage;
    setControls(true);
  });
}, { passive: true });

async function open(input, name) {
  const ticket = ++documentGeneration;
  cancelRender();
  cancelAnimationFrame(zoomFrame);
  zoomFrame = null;
  zoomAnchor = null;
  pageDimensions.clear();
  setControls(false);
  await loading?.destroy();
  if (ticket !== documentGeneration) return;
  pdf = null;
  $("pages").replaceChildren();
  $("pages").hidden = true;
  $("welcome").hidden = false;
  $("password-dialog").close();
  $("progress").style.width = "0";
  filename = name || "document.pdf";
  $("doc-title").textContent = filename;
  document.title = `${filename} · 墨阅`;
  status("正在打开 PDF…");
  const parameters = {
    cMapUrl: new URL("./vendor/cmaps/", import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("./vendor/standard_fonts/", import.meta.url).href,
    wasmUrl: new URL("./vendor/wasm/", import.meta.url).href,
    iccUrl: new URL("./vendor/iccs/", import.meta.url).href,
    isEvalSupported: false,
    useWorkerFetch: true,
    enableXfa: false,
    ...(typeof input === "string" ? { url: input, withCredentials: true } : { data: input })
  };
  const activeLoading = loading = getDocument(parameters);
  activeLoading.onProgress = ({ loaded, total }) => { if (ticket === documentGeneration && total) $("progress").style.width = `${Math.min(100, loaded / total * 100)}%`; };
  activeLoading.onPassword = (callback, reason) => {
    if (ticket !== documentGeneration) return;
    passwordCallback = callback;
    $("password-message").textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? "密码不正确，请再试一次。" : "密码只用于在本机解锁这份文件。";
    if (!$("password-dialog").open) $("password-dialog").showModal();
    $("password").focus();
  };
  try {
    const document = await activeLoading.promise;
    if (ticket !== documentGeneration) { await activeLoading.destroy(); return; }
    pdf = document;
    currentPage = Math.max(1, Math.min(pdf.numPages, Number(new URLSearchParams(location.hash.slice(1)).get("page")) || 1));
    $("page-total").textContent = pdf.numPages;
    $("page-number").max = pdf.numPages;
    $("progress").style.width = "100%";
    $("password-dialog").close();
    setControls(true);
    status("");
    await layout();
  } catch (error) {
    if (ticket !== documentGeneration) return;
    console.error(error);
    $("progress").style.width = "0";
    status(`无法打开 PDF：${error.message}。在线文件可先下载，再选择本地文件打开。`);
  }
}
function fileName(url) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop()) || "document.pdf"; } catch { return "document.pdf"; }
}
async function openFile(file) {
  if (!file) return;
  source = null;
  history.replaceState(null, "", location.pathname);
  raw = false;
  paint();
  try { await open(new Uint8Array(await file.arrayBuffer()), file.name); }
  catch (error) { status(`文件读取失败：${error.message}`); }
}
$("open-file").addEventListener("click", () => $("file-input").click());
$("choose-file").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", event => { openFile(event.target.files[0]); event.target.value = ""; });
$("url-form").addEventListener("submit", event => {
  event.preventDefault();
  const value = pdfSource($("pdf-url").value);
  if (!value || !/^https?:/.test(value)) { status("请输入 HTTP 或 HTTPS 的 PDF 链接。"); return; }
  const url = new URL(value);
  const hash = url.hash;
  url.hash = "";
  history.replaceState(null, "", `${location.pathname}?file=${encodeURIComponent(url.href)}${hash}`);
  source = url.href;
  open(source, fileName(source));
});
$("previous").addEventListener("click", () => jump(currentPage - 1));
$("next").addEventListener("click", () => jump(currentPage + 1));
$("page-number").addEventListener("change", event => jump(event.target.value));
function changeZoom(delta) {
  requestZoom(clampScale(currentScale() + delta));
}
function currentScale() {
  const node = $("pages").children[currentPage - 1];
  return zoom === "fit" ? Number(node?.style.getPropertyValue("--scale-factor")) || 1 : zoom;
}
function captureZoomAnchor(point) {
  const clientX = point?.clientX ?? innerWidth / 2;
  const clientY = Math.max(90, point?.clientY ?? innerHeight / 2);
  const nodes = [...$("pages").children];
  const node = nodes.find(node => { const rect = node.getBoundingClientRect(); return rect.top <= clientY && rect.bottom >= clientY; }) || nodes[currentPage - 1];
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return { page: Number(node.dataset.page), x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height, clientX, clientY };
}
function requestZoom(scale, point) {
  if (!pdf) return;
  zoomAnchor = captureZoomAnchor(point);
  zoom = clampScale(scale);
  if (zoomFrame) return;
  zoomFrame = requestAnimationFrame(() => {
    zoomFrame = null;
    const anchor = zoomAnchor;
    zoomAnchor = null;
    layout(true, anchor).catch(error => status(error.message));
  });
}
attachPdfZoom(window, {
  isEnabled: event => Boolean(pdf && !$("password-dialog").open && !event.target?.closest?.("input,textarea,select,[contenteditable=true]")),
  getScale: currentScale,
  onZoom: requestZoom,
  onFit: () => { zoom = "fit"; layout(); }
});
$("zoom-in").addEventListener("click", () => changeZoom(.2));
$("zoom-out").addEventListener("click", () => changeZoom(-.2));
$("zoom").addEventListener("click", () => { zoom = "fit"; layout(); });
$("original").addEventListener("click", () => { raw = !raw; paint(); layout(); });
$("material").addEventListener("change", async event => {
  try { settings = await saveSettings({ material: event.target.value }); paint(); }
  catch (error) { status(`设置保存失败：${error.message}`); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  readSettings().then(value => { settings = value; paint(); return layout(); }).catch(error => status(error.message));
});
$("download").addEventListener("click", async () => {
  try {
    const url = URL.createObjectURL(new Blob([await pdf.getData()], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { status(`下载失败：${error.message}`); }
});
$("password-form").addEventListener("submit", event => {
  event.preventDefault();
  const password = $("password").value;
  $("password").value = "";
  $("password-dialog").close();
  passwordCallback?.(password);
  passwordCallback = null;
});
async function cancelPassword() {
  documentGeneration++;
  await loading?.destroy();
  $("password").value = "";
  $("password-dialog").close();
  passwordCallback = null;
  status("已取消打开加密文件。");
}
$("cancel-password").addEventListener("click", cancelPassword);
$("password-dialog").addEventListener("cancel", event => { event.preventDefault(); cancelPassword(); });
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (zoom === "fit") layout(); }, 180); });
window.addEventListener("dragover", event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", event => { if (!event.relatedTarget) document.body.classList.remove("dragging"); });
window.addEventListener("drop", event => {
  event.preventDefault(); document.body.classList.remove("dragging");
  const file = event.dataTransfer.files[0];
  if (file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name))) openFile(file);
  else status("请选择 PDF 文件。");
});
window.addEventListener("keydown", event => {
  if (!pdf || event.target.matches("input,textarea,select") || $("password-dialog").open) return;
  if (event.key === "ArrowLeft") jump(currentPage - 1);
  if (event.key === "ArrowRight") jump(currentPage + 1);
});
paint();
if (source) {
  if (source.startsWith("file:") && !await chrome.extension.isAllowedFileSchemeAccess()) status("请在扩展详情开启「允许访问文件网址」，或点击「打开文件」选择此 PDF。");
  else open(source, fileName(source));
} else if (location.search) status("PDF 链接无效，请选择本地文件或粘贴有效链接。");
