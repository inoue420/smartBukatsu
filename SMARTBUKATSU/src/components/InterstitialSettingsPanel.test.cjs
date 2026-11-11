const test = require("node:test"), assert = require("node:assert/strict");
const { load, renderHarness } = require("../../scripts/calendarWeekStartTestHarness.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));
function environment({ refresh = async () => true, save = async value => value } = {}) {
  const h = renderHarness(), writes = [];
  const ads = { interstitialSettings: { audience: "debug", minimumUsageMinutes: 10 },
    refreshInterstitialSettings: refresh, saveGlobalInterstitialSettings: async value => { writes.push(value); return save(value); } };
  const Panel = load("src/components/InterstitialSettingsPanel.js", {
    react: h.react, "react-native": { View: "View", Text: "Text", TouchableOpacity: "Button", ActivityIndicator: "Spinner", StyleSheet: { create: x => x } },
    "../ads/AdManager": { useAds: () => ads }, "../ads/interstitialPolicy": require("../ads/interstitialPolicy"),
  }).default;
  h.mount(Panel);
  return { h, writes, ads, button: name => h.find(node => node.type === "Button" && (h.text(node) === name || node.props.accessibilityLabel === name)),
    async settle() { await tick(); h.render(); } };
}
test("settings load before editing; off/all/debug and 1–30 minutes save only on explicit action", async () => {
  const e = environment(); assert.equal(e.button("広告設定を保存").props.disabled, true); await e.settle();
  e.button("○ 表示停止").props.onPress(); e.h.render();
  for (let i = 0; i < 9; i++) { e.button("1分減らす").props.onPress(); e.h.render(); }
  assert.equal(e.button("1分減らす").props.disabled, true); assert.equal(e.writes.length, 0);
  await e.button("広告設定を保存").props.onPress(); e.h.render();
  assert.deepEqual(JSON.parse(JSON.stringify(e.writes[0])), { audience: "off", minimumUsageMinutes: 1 });
  for (let i = 0; i < 29; i++) { e.button("1分増やす").props.onPress(); e.h.render(); }
  assert.equal(e.button("1分増やす").props.disabled, true);
  e.button("○ 全員").props.onPress(); e.h.render(); await e.button("広告設定を保存").props.onPress();
  assert.equal(e.writes[1].audience, "all"); assert.equal(e.writes[1].minimumUsageMinutes, 30); e.h.unmount();
});
test("failed retrieval prevents saving and failed saves leave the draft available", async () => {
  const failed = environment({ refresh: async () => false }); await failed.settle();
  assert.equal(failed.button("広告設定を保存").props.disabled, true); failed.h.unmount();
  const e = environment({ save: async () => { throw Error("permission-denied"); } }); await e.settle();
  await e.button("広告設定を保存").props.onPress(); e.h.render();
  assert.equal(e.button("広告設定を保存").props.disabled, false);
  assert.ok(e.h.text(e.h.render()).includes("保存結果を確認できませんでした")); e.h.unmount();
});
