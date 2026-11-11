// Optional real-document regression; the PDF stays outside the repository.
// node tests/groot-regression.mjs /path/to/GR00T2.pdf
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "../extension/vendor/pdf.mjs";
import { THEMES } from "../src/settings.js";

if (!process.argv[2]) throw new Error("Pass the local GR00T2.pdf path");
const loading = getDocument({ data: new Uint8Array(await readFile(process.argv[2])), isEvalSupported:false,disableFontFace:true,useSystemFonts:true });
await mkdir("artifacts/groot",{recursive:true});
try {
  const pdf=await loading.promise;
  const page=await pdf.getPage(7);
  const text=await page.getTextContent();
  assert.match(text.items.map(item=>item.str).join(" "),/Table\s*1:/);
  const viewport=page.getViewport({scale:1.5});
  const canvases={};
  for (const [name,theme] of [["original",null],["after",THEMES.paper]]) {
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvasContext:canvas.getContext("2d"),viewport,background:theme?.background||"#ffffff",pageColors:theme?{...theme,ink:true}:null}).promise;
    canvases[name]=canvas;
    await writeFile(`artifacts/groot/page-7-${name}.png`,canvas.toBuffer("image/png"));
  }
  const pixel=(name,x,y)=>[...canvases[name].getContext("2d").getImageData(x,y,1,1).data].slice(0,3);
  const before=pixel("original",212,270);
  const after=pixel("after",212,270);
  assert.deepEqual(before,[237,245,220]);
  assert.ok(Math.max(...after)<60,"Table 1 highlight becomes dark");
  let maxImageDifference=0;
  // Compare the two actual image strips, excluding the page background gap.
  for (const rect of [[96,744,700,87],[96,845,700,85]]) {
    const originalFigure=canvases.original.getContext("2d").getImageData(...rect).data;
    const afterFigure=canvases.after.getContext("2d").getImageData(...rect).data;
    for(let i=0;i<originalFigure.length;i++)maxImageDifference=Math.max(maxImageDifference,Math.abs(originalFigure[i]-afterFigure[i]));
  }
  assert.equal(maxImageDifference,0,"Figure 3 photographs and embedded labels retain every pixel");
  const report={passed:true,page:7,tableBackgroundBefore:before,tableBackgroundAfter:after,figure3MaximumPixelDifference:maxImageDifference,engine:"PDF.js + native Canvas; not a browser test"};
  await writeFile("artifacts/groot/report.json",JSON.stringify(report,null,2)+"\n");
  console.log(report);
} finally {await loading.destroy();}
