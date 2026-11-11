import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { makeFixture } from "./fixture.mjs";
import { THEMES } from "../src/settings.js";
import { getDocument } from "../extension/vendor/pdf.mjs";
import { createPaperPattern } from "../src/paper.js";

await mkdir("artifacts/render", { recursive: true });
const bytes = makeFixture();
await writeFile("artifacts/test-document.pdf", bytes);
const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: true });
const pdf = await loading.promise;
const summary = [];
function pixel(canvas, x, y) { return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data].slice(0, 3); }
function sameRegion(original, dark, x, y, w, h, label) {
  const before = original.getContext("2d").getImageData(x,y,w,h).data;
  const after = dark.getContext("2d").getImageData(x,y,w,h).data;
  let maximum = 0;
  for (let i = 0; i < before.length; i++) maximum = Math.max(maximum, Math.abs(before[i] - after[i]));
  assert.equal(maximum, 0, `${label}: image region must be unchanged`);
}
async function render(page, theme, name, textured = false) {
  const canvas = createCanvas(480, 640);
  const context = canvas.getContext("2d");
  const inkTexture = textured ? createPaperPattern(createCanvas, context, theme.background) : null;
  await page.render({ canvasContext: context, viewport: page.getViewport({scale:1}), background:inkTexture || theme?.background || "#ffffff", pageColors:theme ? { ...theme, ink:true, inkTexture } : null }).promise;
  await writeFile(`artifacts/render/${name}.png`, canvas.toBuffer("image/png"));
  return canvas;
}
try {
  const first = await pdf.getPage(1);
  const original = await render(first, null, "original");
  assert.deepEqual(pixel(original,10,10), [255,255,255]);
  for (const [name, theme] of Object.entries(THEMES)) {
    const dark = await render(first, theme, name);
    const expected = [1,3,5].map(i => parseInt(theme.background.slice(i,i+2),16));
    assert.deepEqual(pixel(dark,10,10), expected, "blank page becomes dark");
    sameRegion(original, dark, 38,220,186,122, `${name}: raster image including black and white`);
    // Region completely inside the rotated, clipped image, away from clip edges.
    sameRegion(original, dark, 295,250,60,50, `${name}: rotated raster image`);
    sameRegion(original, dark, 40,390,80,20, `${name}: colored vectors`);
    assert.ok(Math.max(...pixel(dark,355,455))<80,"pale table background is dark");
    let brightText = 0;
    const data = dark.getContext("2d").getImageData(36,36,350,30).data;
    for (let i=0;i<data.length;i+=4) if (data[i]>170 && data[i+1]>170 && data[i+2]>170) brightText++;
    assert.ok(brightText > 100, "PDF text becomes light");
    summary.push({ theme:name, darkBackground:expected, rasterPixelsUnchanged:true, rotatedImageUnchanged:true, colorfulVectorUnchanged:true, brightTextPixels:brightText });
  }
  const textured = await render(first,THEMES.paper,"paper-textured",true);
  sameRegion(original,textured,38,220,186,122,"paper texture never covers images");
  const textureRegion = textured.getContext("2d").getImageData(0,0,30,30).data;
  const shades = new Set();
  for (let i=0;i<textureRegion.length;i+=4) shades.add(textureRegion[i]);
  assert.ok(shades.size > 2, "background has subtle grain");
  assert.ok(Math.max(...shades)-Math.min(...shades)<=6, "paper texture stays subtle");
  const scan = await pdf.getPage(2);
  const scanOriginal = await render(scan,null,"scan-original");
  const scanDark = await render(scan,THEMES.paper,"scan-paper");
  sameRegion(scanOriginal,scanDark,0,0,480,640,"full-page scanned image");
  assert.equal((await scan.getTextContent()).items.length,0);
  const defaults = await pdf.getPage(3);
  const defaultDark = await render(defaults,THEMES.paper,"default-text");
  let brightDefaults = 0;
  const defaultData = defaultDark.getContext("2d").getImageData(36,50,300,35).data;
  for (let i=0;i<defaultData.length;i+=4) if (defaultData[i]>170) brightDefaults++;
  assert.ok(brightDefaults > 100, "implicit default black text becomes light");
  const report = { passed:true, engine:"PDF.js 6.5.438 + native Canvas (not a browser test)", themes:summary, paperTexturePreservesImages:true, scannedPagePixelsUnchanged:true, defaultTextVisible:true };
  await writeFile("artifacts/render/report.json",JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
} finally { await loading.destroy(); }
