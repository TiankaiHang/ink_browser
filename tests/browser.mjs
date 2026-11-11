import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { makeFixture } from "./fixture.mjs";

// Run outside a sandbox that blocks browser launch / localhost sockets:
// npm run build && npm run test:browser
// BROWSER_PATH=/path/to/Chromium npm run test:browser
const extension = path.resolve("extension");
const executablePath = process.env.BROWSER_PATH || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const profile = await mkdtemp(path.join(tmpdir(), "ink-browser-test-"));
await mkdir("artifacts/browser", { recursive: true });
const errors = [];
async function waitForRules(worker, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    if (predicate(rules)) return rules;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("PDF redirect rule synchronization timed out");
}
const pdf = makeFixture();
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="60"><path fill="#dc4b32" d="M0 0h30v60H0z"/><path fill="#289b5f" d="M30 0h30v60H30z"/><path fill="#3264dc" d="M60 0h30v60H60z"/></svg>';
const server = createServer((request, response) => {
  const url = new URL(request.url,"http://localhost");
  if (url.pathname === "/document.pdf" || url.pathname === "/download") {
    response.writeHead(200, { "Content-Type":"application/pdf", "Cache-Control":"no-store" }); response.end(pdf); return;
  }
  if (url.pathname === "/colors.svg") { response.writeHead(200, {"Content-Type":"image/svg+xml"}); response.end(svg); return; }
  response.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
  response.end('<!doctype html><html><head><title>Ink test article</title><style>body{background:#fff;color:#111;margin:70px;font:18px system-ui}h1{font-size:36px}.card{background:#eee;padding:20px;width:400px}</style></head><body><h1>留一点安静给阅读。</h1><p>文字变浅，图片保留原色。</p><img id="photo" width="90" height="60" src="/colors.svg"><div class="card">动态网页也可以深色阅读。</div></body></html>');
});
let context;
try {
  await new Promise((resolve,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: process.env.HEADED !== "1",
    ignoreDefaultArgs:["--disable-extensions"],
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,"--no-first-run"],
    viewport:{width:1280,height:900},
    deviceScaleFactor:1
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker",{timeout:20000});
  const id = new URL(worker.url()).host;
  await waitForRules(worker, rules => rules.length === 3);
  context.on("page",page => page.on("pageerror",error => errors.push(error.message)));
  const article = await context.newPage();
  await article.goto(base);
  await article.waitForFunction(() => document.documentElement.dataset.inkMaterial === "paper");
  await article.waitForFunction(() => {
    const rgb=getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number);
    return rgb && rgb.slice(0,3).every(x=>x<100);
  });
  assert.equal(await article.locator("#photo").evaluate(node=>getComputedStyle(node).filter),"none");
  await article.screenshot({path:"artifacts/browser/web-paper.png"});
  const imageBefore = await article.locator("#photo").screenshot();
  const reader = await context.newPage();
  await reader.goto(`${base}/download?token=a%2Bb&second=a%26b#page=1`);
  await reader.waitForURL(`chrome-extension://${id}/viewer.html**`);
  await reader.waitForSelector('.pdf-page[data-rendered="true"] canvas');
  assert.equal(await reader.locator("#page-total").textContent(),"3");
  assert.ok(reader.url().includes("second=a%26b"),"signed/query URL preserved");
  await reader.screenshot({path:"artifacts/browser/pdf-paper.png"});
  await reader.selectOption("#material","frost");
  await reader.waitForFunction(()=>document.documentElement.dataset.material==="frost");
  await reader.waitForSelector('.pdf-page[data-rendered="true"] canvas');
  await reader.screenshot({path:"artifacts/browser/pdf-frost.png"});
  await reader.selectOption("#material","black");
  await reader.waitForFunction(()=>document.documentElement.dataset.material==="black");
  await reader.waitForSelector('.pdf-page[data-rendered="true"] canvas');
  await reader.screenshot({path:"artifacts/browser/pdf-black.png"});
  await reader.locator("#original").click();
  assert.equal(await reader.locator("#original").getAttribute("aria-pressed"),"true");
  await reader.waitForSelector('.pdf-page[data-rendered="true"] canvas');
  await reader.screenshot({path:"artifacts/browser/pdf-original.png"});
  await reader.locator("#next").click();
  await reader.locator('#page-number').evaluate(node=>{if(node.value!=="2")throw Error("Page jump failed");});
  // The local file picker works without granting file:// access to the extension.
  const local = await context.newPage();
  await local.goto(`chrome-extension://${id}/viewer.html`);
  await local.locator("#file-input").setInputFiles({name:"local-document.pdf",mimeType:"application/pdf",buffer:pdf});
  await local.waitForSelector('.pdf-page[data-rendered="true"] canvas');
  assert.equal(await local.locator("#doc-title").textContent(),"local-document.pdf");
  const canvas=local.locator('.pdf-page[data-page="1"] canvas');
  const oldWidth=await canvas.evaluate(node=>node.getBoundingClientRect().width);
  const anchorBefore=await local.locator('.pdf-page[data-page="1"]').evaluate(node=>{
    const rect=node.getBoundingClientRect(); return {x:(640-rect.left)/rect.width,y:(400-rect.top)/rect.height};
  });
  await local.mouse.move(640,400);
  await local.keyboard.down("Control");
  await local.mouse.wheel(0,-100);
  await local.keyboard.up("Control");
  await local.waitForFunction(width=>{
    const node=document.querySelector('.pdf-page[data-page="1"] canvas');return node?.getBoundingClientRect().width>width;
  },oldWidth);
  const anchorAfter=await local.locator('.pdf-page[data-page="1"]').evaluate(node=>{
    const rect=node.getBoundingClientRect(); return {x:(640-rect.left)/rect.width,y:(400-rect.top)/rect.height};
  });
  assert.ok(Math.abs(anchorAfter.x-anchorBefore.x)<.005);
  assert.ok(Math.abs(anchorAfter.y-anchorBefore.y)<.005);
  await local.keyboard.press("Control+0");
  await local.waitForFunction(()=>document.getElementById("zoom").textContent==="适宽");
  await worker.evaluate(async()=>{const {settings}=await chrome.storage.local.get("settings");await chrome.storage.local.set({settings:{...settings,enabled:false}});});
  await article.waitForFunction(()=>!document.documentElement.dataset.inkMaterial);
  assert.deepEqual(await article.locator("#photo").screenshot(),imageBefore,"web image appearance unchanged");
  await article.waitForFunction(()=>getComputedStyle(document.body).backgroundColor==="rgb(255, 255, 255)");
  // Wait for asynchronous rule synchronization rather than assuming storage and
  // DNR update in the same tick.
  await waitForRules(worker,rules=>rules.length===0);
  const fileAccess=await worker.evaluate(()=>chrome.extension.isAllowedFileSchemeAccess());
  assert.deepEqual(errors,[],"no uncaught browser errors");
  const report={passed:true,webTheme:true,webImagesUnchanged:true,automaticHttpPdf:true,queryPreserved:true,allMaterials:true,localFilePicker:true,automaticFileUrl:fileAccess?"available; manually verify local URL":"requires user to allow file URL access",browserErrors:errors};
  await writeFile("artifacts/browser/report.json",JSON.stringify(report,null,2)+"\n");
  console.log(report);
} catch(error) {
  await writeFile("artifacts/browser/report.json",JSON.stringify({passed:false,error:error.message},null,2)+"\n");
  throw error;
} finally {
  await context?.close();
  server.close();
  await rm(profile,{recursive:true,force:true});
}
