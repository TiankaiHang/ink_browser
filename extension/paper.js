export function createPaperPattern(makeCanvas, context, color) {
  const tile = makeCanvas(128, 128);
  const ctx = tile.getContext("2d");
  const data = ctx.createImageData(128, 128);
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  let seed = 9817;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed >>> 28) / 3 - 2.5;
    for (let c = 0; c < 3; c++) data.data[i + c] = Math.max(0, Math.min(255, rgb[c] + noise));
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return context.createPattern(tile, "repeat");
}
