# Third-party software

- PDF.js / pdfjs-dist 6.5.438, Mozilla Foundation, Apache-2.0. https://github.com/mozilla/pdf.js
- Dark Reader 4.9.135, Dark Reader Ltd, MIT. https://github.com/darkreader/darkreader

Both libraries are bundled locally. The extension loads no executable code from a CDN.

`scripts/build.mjs` applies an explicit, checked patch to the PDF.js legacy main-thread renderer. It routes solid text and vector colors through `src/pdf-colors.mjs`, initializes the default drawing color, and skips the whole-page high-contrast filter for the custom `pageColors.ink` option. Raster painting and soft-mask painting are not recolored. The worker is unchanged. The exact dependency versions and checked patch anchors make upgrades fail explicitly if the integration changes.

Saturated vector graphics and gradients retain their original colors. Pale colored solid fills become dark tinted surfaces, so light table highlights remain readable alongside recolored text. Grayscale vector graphics can change along with text and backgrounds. Scanned pages are images and retain their original colors. This is not OCR.
