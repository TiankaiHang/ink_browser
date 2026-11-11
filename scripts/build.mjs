import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "extension");
await mkdir(out, { recursive: true });
await cp(path.join(root, "src"), out, { recursive: true });
await mkdir(path.join(out, "vendor"), { recursive: true });
const pdfRoot = path.join(root, "node_modules/pdfjs-dist");
let source = await readFile(path.join(pdfRoot, "legacy/build/pdf.mjs"), "utf8");
function patch(before, after, expected = 1) {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`PDF.js patch mismatch (${count}/${expected}): ${before.slice(0, 70)}`);
  source = source.replaceAll(before, after);
}
// Narrow, version-checked patch: recolor solid vector/text drawing styles before
// compositing. Never run PDF.js's whole-canvas high-contrast filter over images.
patch('  #transferColor(color) {\n    return this.current.transferMapsFallback?.applyToColor(color) ?? color;\n  }',
  '  #transferColor(color) {\n    const transferred = this.current.transferMapsFallback?.applyToColor(color) ?? color;\n    const mapped = mapPdfColor(transferred, this.pageColors, this.smaskStack.length);\n    return !this.smaskStack.length && this.pageColors?.inkTexture && mapped === this.pageColors.background ? this.pageColors.inkTexture : mapped;\n  }');
patch('    if (this.pageColors) {\n      const hcmFilterId', '    if (this.pageColors && !this.pageColors.ink) {\n      const hcmFilterId');
patch('    resetCtxToDefault(this.ctx);', '    resetCtxToDefault(this.ctx);\n    this.ctx.strokeStyle = this.ctx.fillStyle = this.#transferColor("#000000");', 4);
source = 'import { mapPdfColor } from "../pdf-colors.mjs";\n' + source;
await writeFile(path.join(out, "vendor/pdf.mjs"), source);
await cp(path.join(pdfRoot, "legacy/build/pdf.worker.mjs"), path.join(out, "vendor/pdf.worker.mjs"));
await cp(path.join(pdfRoot, "web/pdf_viewer.css"), path.join(out, "vendor/pdf_viewer.css"));
await cp(path.join(pdfRoot, "web/images"), path.join(out, "vendor/images"), { recursive: true });
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) await cp(path.join(pdfRoot, directory), path.join(out, "vendor", directory), { recursive: true });
await cp(path.join(root, "node_modules/darkreader/darkreader.js"), path.join(out, "vendor/darkreader.js"));
const shared = (await readFile(path.join(root, "src/settings.js"), "utf8")).replaceAll(/^export /gm, "");
await writeFile(path.join(out, "content.js"), `{\n${shared}\n${await readFile(path.join(root, "src/content.js"), "utf8")}\n}\n`);
await mkdir(path.join(out, "licenses"), { recursive: true });
await cp(path.join(pdfRoot, "LICENSE"), path.join(out, "licenses/PDFJS-LICENSE"));
await cp(path.join(root, "node_modules/darkreader/LICENSE"), path.join(out, "licenses/DARKREADER-LICENSE"));
await cp(path.join(root, "THIRD_PARTY.md"), path.join(out, "licenses/THIRD_PARTY.md"));
// Native canvas is only a development dependency; no native code ships in the extension.
const { createCanvas } = await import("@napi-rs/canvas");
for (const size of [16, 48, 128]) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#20251c";
  ctx.beginPath(); ctx.roundRect(0, 0, size, size, size * .25); ctx.fill();
  ctx.strokeStyle = "#c1d4a6"; ctx.lineWidth = size * .065; ctx.lineCap = "round";
  for (const [x, a, b] of [[.31,.33,.69],[.5,.23,.78],[.69,.4,.63]]) { ctx.beginPath(); ctx.moveTo(size*x,size*a); ctx.lineTo(size*x,size*b); ctx.stroke(); }
  await writeFile(path.join(out, `assets/icon-${size}.png`), canvas.toBuffer("image/png"));
}
await mkdir(path.join(root, "artifacts"), { recursive: true });
const { version } = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
const zip = path.join(root, `artifacts/ink-browser-${version}.zip`);
await rm(zip, { force: true });
execFileSync("/usr/bin/zip", ["-q", "-r", zip, "extension"], { cwd: root });
console.log(`Built ${out}\nPackaged ${zip}`);
