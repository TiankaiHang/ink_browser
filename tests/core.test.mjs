import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULTS, normalizeSettings, THEMES, siteKey, pdfSource, viewerUrl, sourceFromViewer, isExcluded } from "../src/settings.js";
import { makePdfRules } from "../src/pdf-rules.js";
import { mapPdfColor } from "../src/pdf-colors.mjs";

test("defaults preserve images with a dark paper theme", () => {
  assert.deepEqual(normalizeSettings(), DEFAULTS);
  assert.equal(normalizeSettings({ material: "__proto__", enabled: "false" }).material, "paper");
  assert.equal(normalizeSettings({ enabled: false }).enabled, false);
  assert.deepEqual(normalizeSettings({ excludedHosts: ["Example.com", "example.com", 42, "https://bad", "<script>"] }).excludedHosts, ["example.com"]);
});
test("source URLs are validated, and the entire query survives redirects", () => {
  for (const url of ["https://example.com/a.pdf?token=a%2Bb&file=b%26c#page=2", "file:///Users/test/A%20B.pdf#page=3", "https://example.com/download?id=42&signature=%25"]) {
    const redirected = new URL(viewerUrl("chrome-extension://test/viewer.html", url));
    const original = new URL(url); original.hash = "";
    assert.equal(sourceFromViewer(redirected), original.href);
    assert.equal(sourceFromViewer(new URL(`chrome-extension://test/viewer.html?source:${original.href}`)), original.href);
  }
  for (const input of ["javascript:alert(1)", "data:application/pdf,x", "https://user:pass@example.com/file", "blob:https://example.com/abc", "bad"]) assert.equal(pdfSource(input), null);
});
test("site controls identify supported hosts", () => {
  assert.equal(siteKey("https://EXAMPLE.com/a"), "example.com");
  assert.equal(siteKey("chrome://extensions"), "");
  assert.equal(isExcluded("https://example.com/a.pdf", { excludedHosts:["example.com"] }), true);
  assert.equal(isExcluded(null, { excludedHosts:[] }), false);
});
test("automatic PDF rules respect toggles, MIME type, downloads, and request methods", () => {
  assert.deepEqual(makePdfRules({ ...DEFAULTS, enabled: false }, "viewer"), []);
  assert.deepEqual(makePdfRules({ ...DEFAULTS, pdfEnabled: false }, "viewer"), []);
  const rules = makePdfRules({ ...DEFAULTS, excludedHosts:["example.com"] }, "chrome-extension://id/viewer.html");
  assert.equal(rules.length, 3);
  for (const rule of rules) {
    assert.deepEqual(rule.condition.requestMethods, ["get"]);
    assert.deepEqual(rule.condition.resourceTypes, ["main_frame", "sub_frame"]);
    assert.deepEqual(rule.condition.excludedRequestDomains, ["example.com"]);
    assert.ok(!rule.condition.resourceTypes.includes("xmlhttprequest"));
  }
  assert.equal(rules[2].condition.responseHeaders[0].header, "content-type");
  assert.equal(rules[2].condition.excludedResponseHeaders[0].header, "content-disposition");
  assert.match("file:///a%20b.PDF?foo=1", new RegExp(rules[1].condition.regexFilter, "i"));
  assert.doesNotMatch("https://example.com/document.pdf.html", new RegExp(rules[1].condition.regexFilter, "i"));
  assert.equal(rules[2].action.redirect.regexSubstitution, "chrome-extension://id/viewer.html?source:\\0");
});
test("PDF mapping changes neutral colors and leaves chromatic colors and mask colors alone", () => {
  for (const theme of Object.values(THEMES)) {
    const colors = { ...theme, ink: true };
    assert.equal(mapPdfColor("#000000", colors), theme.foreground);
    assert.equal(mapPdfColor("#ffffff", colors), theme.background);
    assert.equal(mapPdfColor("#f04a32", colors), "#f04a32");
    assert.equal(mapPdfColor("#000000", colors, 1), "#000000");
    assert.equal(mapPdfColor("#ffffff", colors, 2), "#ffffff");
    assert.equal(mapPdfColor("transparent", colors), "transparent");
    assert.equal(mapPdfColor("#000000", null), "#000000");
    assert.equal(mapPdfColor("#000000", { ...colors, ink: false }), "#000000");
  }
});
test("pale table backgrounds are darkened while preserving their hue", () => {
  for (const theme of Object.values(THEMES)) {
    const colors = { ...theme, ink: true };
    for (const original of ["#edf5dc", "#e3efff", "#fff0d0", "#fbe1ed"]) {
      const mapped = mapPdfColor(original, colors);
      const rgb = [1,3,5].map(i=>parseInt(mapped.slice(i,i+2),16));
      assert.ok(Math.max(...rgb)<80, `${original} becomes a dark surface`);
      assert.equal(mapPdfColor(original,colors,1),original,"soft masks are unchanged");
    }
    const green = mapPdfColor("#edf5dc", colors);
    assert.ok(parseInt(green.slice(3,5),16)>parseInt(green.slice(5,7),16),"green tint remains");
    for (const original of ["#76b900", "#00ff00", "#ffdd00", "#336699"]) assert.equal(mapPdfColor(original,colors),original);
  }
});
test("built extension references local assets and keeps a strict MV3 CSP", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
  assert.ok(!manifest.permissions.includes("tabs"));
  for (const path of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts[0].js, ...Object.values(manifest.icons)]) assert.ok((await readFile(`extension/${path}`)).length > 0);
  const renderer = await readFile("extension/vendor/pdf.mjs", "utf8");
  assert.ok(renderer.includes("mapPdfColor(transferred, this.pageColors, this.smaskStack.length)"));
  assert.ok(renderer.includes("this.pageColors && !this.pageColors.ink"));
  const content = await readFile("extension/content.js", "utf8");
  assert.ok(content.includes('ignoreImageAnalysis: ["*"]'));
});
