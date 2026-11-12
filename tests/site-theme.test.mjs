import test from "node:test";
import assert from "node:assert/strict";
import { isFeishuDrive, createFeishuNativeTheme, feishuMaterialCSS } from "../src/site-theme.js";
import { THEMES } from "../src/settings.js";

function documentFixture(theme) {
  const attributes = new Map(theme === null ? [] : [["data-theme", theme]]);
  const styles = [];
  let callback;
  let observing = false;
  const root = {
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name)
  };
  const document = {
    documentElement: root,
    defaultView: { MutationObserver: class {
      constructor(fn) { callback = fn; }
      observe() { observing = true; }
      disconnect() { observing = false; }
    } },
    head: { append(style) { styles.push(style); style.isConnected = true; } },
    createElement() { return { dataset: {}, isConnected: false, textContent: "", remove() { this.isConnected = false; } }; }
  };
  return { document, styles, changeTheme(value) {
    if (value === null) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", value);
    if (observing) callback();
  } };
}

test("native theme routing is limited to Feishu Drive", () => {
  assert.equal(isFeishuDrive("https://tenant.feishu.cn/drive/home/"), true);
  assert.equal(isFeishuDrive("https://tenant.feishu.cn/drive/folder/abc"), true);
  for (const url of ["https://accounts.feishu.cn/login", "https://tenant.feishu.cn/docx/abc", "https://feishu.cn.evil.test/drive/home/", "http://tenant.feishu.cn/drive/home/", "not-a-url"]) assert.equal(isFeishuDrive(url), false);
});
test("each material pairs dark surfaces with light text on the native token scope", () => {
  for (const theme of Object.values(THEMES)) {
    const css = feishuMaterialCSS(theme);
    assert.ok(css.includes("html[data-ink-material] .ccm-scope"));
    assert.ok(css.includes(`--bg-body: ${theme.background} !important`));
    assert.ok(css.includes(`--bg-float: ${theme.surface} !important`));
    assert.ok(css.includes(`--text-title: ${theme.foreground} !important`));
    assert.ok(!css.includes("filter:") && !css.includes("background-image:"), "does not filter thumbnails or replace their images");
  }
});
test("native theme restores light, dark, and absent site preferences on disable", () => {
  for (const before of [null, "light", "dark"]) {
    const fixture = documentFixture(before);
    const adapter = createFeishuNativeTheme(fixture.document);
    adapter.enable(THEMES.paper);
    assert.equal(fixture.document.documentElement.getAttribute("data-theme"), "dark");
    adapter.enable(THEMES.frost);
    assert.equal(fixture.styles.filter(style => style.isConnected).length, 1);
    assert.ok(fixture.styles[0].textContent.includes(THEMES.frost.background));
    adapter.disable();
    adapter.disable();
    assert.equal(fixture.document.documentElement.getAttribute("data-theme"), before);
    assert.equal(fixture.styles.filter(style => style.isConnected).length, 0);
  }
});
test("late app theme updates stay dark and retain the new site preference", () => {
  const fixture = documentFixture("dark");
  const adapter = createFeishuNativeTheme(fixture.document);
  adapter.enable(THEMES.paper);
  fixture.changeTheme("light");
  assert.equal(fixture.document.documentElement.getAttribute("data-theme"), "dark");
  adapter.disable();
  assert.equal(fixture.document.documentElement.getAttribute("data-theme"), "light");
  fixture.changeTheme(null);
  assert.equal(fixture.document.documentElement.getAttribute("data-theme"), null);
});
