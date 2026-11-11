// Color conversion is applied to PDF drawing styles only. Raster image bytes,
// transparency masks, gradients, and saturated diagrams keep their source colors.
export function mapPdfColor(color, pageColors, maskDepth = 0) {
  if (!pageColors?.ink || maskDepth || !/^#[0-9a-f]{6}$/i.test(color)) return color;
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const lightness = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
  const foreground = [1, 3, 5].map(i => parseInt(pageColors.foreground.slice(i, i + 2), 16));
  const background = [1, 3, 5].map(i => parseInt(pageColors.background.slice(i, i + 2), 16));
  if (Math.max(...rgb) - Math.min(...rgb) > 24) {
    // Pale colored fills are often table highlights, not photos. Leaving them
    // bright while making black text white destroys contrast. Retain a gentle
    // hue on a dark surface; raster image painting never calls this function.
    if (Math.min(...rgb) < 180 || lightness < .75) return color;
    return "#" + background.map((v, i) => Math.round(Math.max(0, Math.min(255, v + 8 + (rgb[i] - lightness * 255) * .35))).toString(16).padStart(2, "0")).join("");
  }
  return "#" + foreground.map((v, i) => Math.round(v * (1 - lightness) + background[i] * lightness).toString(16).padStart(2, "0")).join("");
}
