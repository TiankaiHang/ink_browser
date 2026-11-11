import { deflateSync } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";

// A tiny authored PDF with actual image XObjects, clipped and rotated images,
// a luminosity soft mask, colored vectors, and text using the PDF default color.
// No remote test document or additional PDF generation library is needed.
export function makeFixture() {
  const objects = [];
  const add = value => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value)); return objects.length; };
  const stream = (dictionary, bytes) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from("\nendstream")]);
  const catalog = add("");
  const pages = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const imageWidth = 64, imageHeight = 64;
  const imageData = Buffer.alloc(imageWidth * imageHeight * 3);
  for (let y = 0; y < imageHeight; y++) for (let x = 0; x < imageWidth; x++) {
    const color = x < 16 ? [220,75,50] : x < 32 ? [40,155,95] : x < 48 ? [50,100,220] : y < 16 ? [0,0,0] : y < 32 ? [237,245,220] : [255,255,255];
    imageData.set(color, (y * imageWidth + x) * 3);
  }
  const image = add(stream(`/Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, deflateSync(imageData)));
  const mask = add(stream("/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 120 50] /Group << /S /Transparency /CS /DeviceGray >> /Resources << >>", Buffer.from("0.5 g 0 0 120 50 re f")));
  const gs = add(`<< /Type /ExtGState /SMask << /S /Luminosity /G ${mask} 0 R >> >>`);
  const commands = [
    "1 1 1 rg 0 0 480 640 re f",
    // q/Q restores default black; it tests both default and explicit text colors.
    "0 0 0 rg BT /F1 26 Tf 36 580 Td (Ink: quieter reading.) Tj ET",
    "0.25 g BT /F1 12 Tf 36 550 Td (Text changes. Images keep their colors.) Tj ET",
    "0.92 g 36 470 408 48 re f",
    "0 g BT /F1 14 Tf 48 488 Td (Soft background and readable text.) Tj ET",
    "q 192 0 0 128 36 294 cm /Im1 Do Q",
    "q 270 295 110 110 re W n 128 24 -24 128 280 285 cm /Im1 Do Q",
    "0.85 0.2 0.15 rg 36 220 90 35 re f",
    "0 g BT /F1 12 Tf 140 232 Td (Colorful vector diagram) Tj ET",
    "q 1 0 0 1 36 140 cm /GS1 gs 0.2 0.6 0.9 rg 0 0 120 50 re f Q",
    "0.929412 0.960784 0.862745 rg 350 140 94 50 re f",
    "0 g BT /F1 12 Tf 360 160 Td (Table tint) Tj ET",
    "0 g BT /F1 12 Tf 36 88 Td (Images: red, green, blue, black, white.) Tj ET"
  ].join("\n");
  const content = add(stream("", Buffer.from(commands)));
  const resources = `/Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> /ExtGState << /GS1 ${gs} 0 R >>`;
  const page = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 480 640] /Resources << ${resources} >> /Contents ${content} 0 R >>`);
  // Full-page bitmap page: a scanned PDF must stay byte-for-byte the same color.
  const scanContent = add(stream("", Buffer.from("q 480 0 0 640 0 0 cm /Im1 Do Q")));
  const scanPage = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 480 640] /Resources << ${resources} >> /Contents ${scanContent} 0 R >>`);
  // Text with no color command at all exercises the default PDF black state.
  const defaultContent = add(stream("", Buffer.from("BT /F1 24 Tf 36 560 Td (Default black text) Tj ET")));
  const defaultPage = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 480 640] /Resources << ${resources} >> /Contents ${defaultContent} 0 R >>`);
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  objects[pages - 1] = Buffer.from(`<< /Type /Pages /Kids [${page} 0 R ${scanPage} 0 R ${defaultPage} 0 R] /Count 3 >>`);
  const pieces = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let length = pieces[0].length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const piece = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), obj, Buffer.from("\nendobj\n")]);
    pieces.push(piece); length += piece.length;
  });
  pieces.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(x => `${String(x).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(pieces);
}
if (process.argv[1]?.endsWith("fixture.mjs")) {
  await mkdir("artifacts", { recursive:true });
  await writeFile("artifacts/test-document.pdf", makeFixture());
  console.log("Created artifacts/test-document.pdf");
}
