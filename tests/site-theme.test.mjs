import test from "node:test";
import assert from "node:assert/strict";
import { feishuPageMode, createFeishuNativeTheme, FEISHU_NATIVE_EVENT } from "../src/site-theme.js";
import { createNativeThemeController } from "../src/feishu-native-controller.js";

function fixture() {
  const attributes = new Map([["data-theme", "light"]]);
  const events = new EventTarget();
  const document = {
    documentElement: {
      getAttribute: name => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: name => attributes.delete(name)
    },
    defaultView: { CustomEvent },
    dispatchEvent: events.dispatchEvent.bind(events)
  };
  const calls = [];
  const timers = new Map();
  let nextId = 0;
  const window = { location: { href: "https://tenant.feishu.cn/wiki/test?contentTheme=light" }, matchMedia: () => ({ matches: false }) };
  const controller = createNativeThemeController({ window, document, schedule: fn => { timers.set(++nextId, fn); return nextId; }, cancel: id => timers.delete(id), maxAttempts: 3 });
  return { attributes, calls, timers, document, window, controller, events,
    installAPI() {
      window.switchUIState = value => calls.push(["ui", value]);
      window.switchContentUIState = value => calls.push(["content", value]);
    },
    tick() { const entry = timers.entries().next().value; if (entry) { timers.delete(entry[0]); entry[1](); } }
  };
}

test("Feishu Drive, Wiki, and editors share native-only routing", () => {
  assert.equal(feishuPageMode("https://tenant.feishu.cn/drive/home/"), "drive");
  for (const path of ["/wiki/test", "/sheets/test", "/docx/test", "/docs/test", "/base/test", "/slides/test", "/mindnotes/test", "/file/test"]) assert.equal(feishuPageMode(`https://tenant.feishu.cn${path}`), "document");
  for (const url of ["https://accounts.feishu.cn/login", "https://feishu.cn.evil.test/wiki/test", "http://tenant.feishu.cn/sheets/test", "not-a-url"]) assert.equal(feishuPageMode(url), null);
});
test("the isolated script requests native mode without rewriting the site theme", () => {
  const f = fixture();
  const adapter = createFeishuNativeTheme(f.document);
  let count = 0;
  f.events.addEventListener(FEISHU_NATIVE_EVENT, () => count++);
  adapter.enable();
  assert.equal(f.attributes.get("data-theme"), "light");
  assert.equal(f.attributes.get("data-ink-feishu-native"), "enabled");
  adapter.disable();
  adapter.disable();
  assert.equal(f.attributes.get("data-theme"), "light");
  assert.equal(f.attributes.has("data-ink-feishu-native"), false);
  assert.equal(count, 2);
});
test("native content and UI callbacks are invoked together and restored together", () => {
  const f = fixture(); f.installAPI();
  f.controller.request(true);
  assert.deepEqual(f.calls, [["content", "dark"], ["ui", { mode: "DARK", vars: {} }]]);
  assert.equal(f.attributes.get("data-ink-feishu-native-status"), "applied");
  assert.equal(f.attributes.get("data-theme"), "light", "controller never fakes native mode by setting data-theme");
  f.controller.request(false);
  assert.deepEqual(f.calls.slice(2), [["content", "light"], ["ui", { mode: "LIGHT", vars: {} }]]);
  assert.equal(f.attributes.has("data-ink-feishu-native-status"), false);
});
test("wait for both native APIs; never apply UI-only dark mode", () => {
  const f = fixture();
  f.window.switchUIState = value => f.calls.push(["ui", value]);
  f.controller.request(true);
  assert.equal(f.attributes.get("data-ink-feishu-native-status"), "pending");
  assert.deepEqual(f.calls, []);
  f.tick();
  assert.deepEqual(f.calls, []);
  f.installAPI(); f.tick();
  assert.deepEqual(f.calls, [["content", "dark"], ["ui", { mode: "DARK", vars: {} }]]);
});
test("missing native APIs leave the page unchanged and eventually stop polling", () => {
  const f = fixture(); f.controller.request(true); f.tick(); f.tick();
  assert.equal(f.attributes.get("data-ink-feishu-native-status"), "unavailable");
  assert.equal(f.attributes.get("data-theme"), "light");
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.calls, []);
});
test("disabling during app startup cancels pending theme requests", () => {
  const f = fixture(); f.controller.request(true); f.controller.request(false);
  f.installAPI(); f.tick();
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.calls, []);
});
test("native callback failure restores both settings without a CSS fallback", () => {
  const f = fixture(); f.installAPI();
  f.window.switchUIState = value => { f.calls.push(["ui", value]); if (value.mode === "DARK") throw new Error("unsupported"); };
  f.controller.request(true);
  assert.deepEqual(f.calls, [["content", "dark"], ["ui", { mode: "DARK", vars: {} }], ["content", "light"], ["ui", { mode: "LIGHT", vars: {} }]]);
  assert.equal(f.attributes.get("data-ink-feishu-native-status"), "unavailable");
  assert.equal(f.attributes.get("data-theme"), "light");
});
