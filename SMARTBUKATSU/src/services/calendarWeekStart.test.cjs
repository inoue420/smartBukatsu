const test = require("node:test"), assert = require("node:assert/strict");
const { monthWindow } = require("../utils/historyLoading");
const { load, loadCalendarSettingsService, screenHarness, appHarness } = require("../../scripts/calendarWeekStartTestHarness.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("both ranges match the installed calendar's rendered grid, including leap years and year boundaries", () => {
  const XDate = require("xdate");
  const { page } = load("node_modules/react-native-calendars/src/dateutils.js", {
    xdate: XDate, "./interface": { toMarkingFormat: date => date.toString("yyyy-MM-dd") },
  });
  for (let year = 2020; year <= 2035; year++) for (let month = 1; month <= 12; month++) for (const firstDay of [0, 1]) {
    const day = `${year}-${String(month).padStart(2, "0")}-01`;
    const grid = page(new XDate(day, true), firstDay);
    assert.deepEqual(monthWindow(day, firstDay), { start: grid[0].toString("yyyy-MM-dd"), end: grid.at(-1).toString("yyyy-MM-dd") }, day);
  }
  assert.deepEqual(monthWindow("2026-02-01", 1), { start: "2026-01-26", end: "2026-03-01" });
  assert.deepEqual(monthWindow("2026-10-01"), { start: "2026-09-27", end: "2026-10-31" });
});

test("saving writes only one team's boolean and rejects invalid input without a write", async () => {
  const writes = [], save = loadCalendarSettingsService("db", {
    doc: (...args) => args, updateDoc: async (...args) => writes.push(args),
  });
  await save("a", true); await save("a", false);
  assert.deepEqual(writes, [ [["db", "teams", "a"], { calendarWeekStartsOnMonday: true }],
    [["db", "teams", "a"], { calendarWeekStartsOnMonday: false }] ]);
  for (const value of [undefined, null, "true", 0, 1]) await assert.rejects(save("a", value));
  await assert.rejects(save("", true)); assert.equal(writes.length, 2);
});

for (const os of ["android", "ios", "web"]) test(`${os}: the supervisor can save ON/OFF and remote changes update the draft`, async () => {
  const s = screenHarness("SettingsScreen", {}, {}, os);
  const toggle = () => s.byLabel("カレンダーを月曜始まりにする");
  const save = () => s.button("カレンダーの開始曜日を保存");
  assert.equal(toggle().props.value, false); assert.equal(toggle().props.disabled, false);
  toggle().props.onValueChange(true); s.h.render(); assert.equal(s.writes.length, 0);
  await save().props.onPress(); s.h.render(); assert.deepEqual(s.writes[0], ["a", true]);
  s.change({ calendarWeekStartsOnMonday: true });
  toggle().props.onValueChange(false); s.h.render(); await save().props.onPress(); s.h.render();
  assert.deepEqual(s.writes[1], ["a", false]);
  s.change({ calendarWeekStartsOnMonday: false }); assert.equal(toggle().props.value, false);
  s.change({ calendarWeekStartsOnMonday: true }); assert.equal(toggle().props.value, true); s.h.unmount();
});

test("only owner/admin see the setting, and unresolved team data disables saving", () => {
  for (const role of ["owner", "admin", "staff", "captain", "member", "guardian"]) {
    const s = screenHarness("SettingsScreen", { userProfiles: { Coach: { uid: "coach", role } } });
    assert.equal(Boolean(s.byLabel("カレンダーを月曜始まりにする")), ["owner", "admin"].includes(role), role); s.h.unmount();
  }
  const s = screenHarness("SettingsScreen", { calendarSettingsReady: false });
  assert.equal(s.byLabel("カレンダーを月曜始まりにする").props.disabled, true);
  const save = s.button("カレンダーの開始曜日を保存"); assert.equal(save.props.disabled, true);
  save.props.onPress(); assert.equal(s.writes.length, 0); s.h.unmount();
  const unresolvedRole = screenHarness("SettingsScreen", { isAdmin: true, userProfiles: {} });
  assert.equal(unresolvedRole.byLabel("カレンダーを月曜始まりにする"), undefined); unresolvedRole.h.unmount();
});

test("duplicate save is suppressed; a late previous-team success cannot complete the new team's save", async () => {
  const pending = [], writes = [];
  const s = screenHarness("SettingsScreen", {}, { updateCalendarWeekStartSettings: (...args) => {
    writes.push(args); const task = deferred(); pending.push(task); return task.promise;
  } });
  s.byLabel("カレンダーを月曜始まりにする").props.onValueChange(true); s.h.render();
  const press = s.button("カレンダーの開始曜日を保存").props.onPress;
  const old = press(); await press(); s.h.render(); assert.equal(writes.length, 1);
  s.change({ calendarWeekStartsOnMonday: false }, { activeTeamId: "b" });
  assert.equal(s.byLabel("カレンダーを月曜始まりにする").props.value, false);
  const current = s.button("カレンダーの開始曜日を保存").props.onPress(); s.h.render();
  assert.deepEqual(writes, [["a", true], ["b", false]]);
  pending[0].resolve(); await old; s.h.render(); assert.equal(s.alerts.length, 0);
  assert.equal(s.byLabel("カレンダーを月曜始まりにする").props.disabled, true);
  pending[1].resolve(); await current; s.h.render(); assert.equal(s.alerts.length, 1);
  assert.equal(s.byLabel("カレンダーを月曜始まりにする").props.disabled, false); s.h.unmount();
});

test("save errors stay retryable and a late failure after sign-out does not show an alert", async () => {
  const task = deferred(), s = screenHarness("SettingsScreen", {}, { updateCalendarWeekStartSettings: () => task.promise });
  const save = s.button("カレンダーの開始曜日を保存").props.onPress(); s.h.render();
  task.reject(new Error("synthetic failure")); await save; s.h.render();
  assert.equal(s.alerts[0][0], "保存できませんでした");
  assert.equal(s.byLabel("カレンダーを月曜始まりにする").props.disabled, false); s.h.unmount();
  const late = deferred(), other = screenHarness("SettingsScreen", {}, { updateCalendarWeekStartSettings: () => late.promise });
  const old = other.button("カレンダーの開始曜日を保存").props.onPress();
  other.change({ calendarSettingsReady: false }, { user: null }); late.reject(new Error("obsolete")); await old;
  assert.equal(other.alerts.length, 0); other.h.unmount();
});

for (const os of ["android", "ios", "web"]) test(`${os}: all three calendars and the report query switch together`, () => {
  const months = [], s = screenHarness("CalendarScreen", { calendarFirstDay: 1, onVisibleMonthChange: day => months.push(day) }, {}, os);
  const main = () => s.h.find(node => node.type === "Calendar");
  main().props.onMonthChange({ dateString: "2026-02-01" }); s.h.render();
  assert.equal(main().props.firstDay, 1); assert.equal(months.at(-1), "2026-02-01");
  assert.equal(s.histories.at(-1)[3].start, "2026-01-26"); assert.equal(s.histories.at(-1)[3].end, "2026-03-01");
  const add = s.h.all(node => node.type === "TouchableOpacity" && s.h.text(node) === "＋ 追加");
  add[0].props.onPress(); s.h.render();
  s.button("複数日").props.onPress(); s.h.render();
  assert.ok(s.h.all(node => node.type === "Calendar").length >= 2);
  assert.ok(s.h.all(node => node.type === "Calendar").every(node => node.props.firstDay === 1));
  s.button("キャンセル").props.onPress(); s.h.render();
  s.h.all(node => node.type === "TouchableOpacity" && s.h.text(node) === "＋ 追加")[1].props.onPress(); s.h.render();
  s.button("複数日").props.onPress(); s.h.render();
  s.h.find(node => node.type === "TouchableOpacity" && s.h.text(node).startsWith("🗓️ ")).props.onPress(); s.h.render();
  assert.equal(s.h.all(node => node.type === "Calendar").length, 2);
  assert.ok(s.h.all(node => node.type === "Calendar").every(node => node.props.firstDay === 1));
  s.change({ calendarFirstDay: 0 });
  assert.ok(s.h.all(node => node.type === "Calendar").every(node => node.props.firstDay === 0));
  assert.equal(s.histories.at(-1)[3].start, "2026-02-01"); assert.equal(s.histories.at(-1)[3].end, "2026-02-28"); s.h.unmount();
});

test("App reuses its team listener; settings and event ranges react immediately without mixing teams or accounts", async () => {
  const s = appHarness(), { h } = s;
  assert.equal(s.screen("Settings").calendarSettingsReady, false);
  const a = s.latest("TeamData"), membersA = s.latest("TeamMembers");
  a.args[1]({ calendarWeekStartsOnMonday: true }); membersA.args[1]([{ uid: "coach", name: "Coach", role: "admin" }]); h.render();
  assert.equal(s.screen("Calendar").calendarFirstDay, 1); assert.equal(s.screen("Calendar").reportReadsReady, true);
  s.latest("LoadingState").args[1]({ ready: true, enabled: true, schemaVersion: 1 }); h.render(); s.navigate("Calendar");
  s.screen("Calendar").onVisibleMonthChange("2026-10-01"); h.render();
  const range = name => s.histories.findLast(args => args[1] === name && args[2])?.[3];
  assert.equal(range("clubEvents").start, "2026-09-28"); assert.equal(range("clubEvents").end, "2026-11-01");
  assert.equal(range("personalEvents").end, "2026-11-01");
  a.args[1]({ calendarWeekStartsOnMonday: false }); h.render();
  assert.equal(s.screen("Calendar").calendarFirstDay, 0); assert.equal(range("clubEvents").end, "2026-10-31");
  assert.equal(s.subscriptions.filter(sub => sub.name === "TeamData").length, 1);
  s.change({ activeTeamId: "b" }); assert.equal(s.screen("Settings").calendarSettingsReady, false);
  a.args[1]({ calendarWeekStartsOnMonday: true }); h.render(); assert.equal(s.screen("Calendar").calendarFirstDay, 0);
  const b = s.latest("TeamData"); b.args[1]({}); h.render();
  assert.equal(s.screen("Settings").calendarSettingsReady, true); assert.equal(s.screen("Calendar").calendarFirstDay, 0);
  b.args[1]({ calendarWeekStartsOnMonday: "true" }); h.render(); assert.equal(s.screen("Calendar").calendarFirstDay, 0);
  b.args[1]({ calendarWeekStartsOnMonday: true }); h.render(); assert.equal(s.screen("Calendar").calendarFirstDay, 1);
  s.change({ user: { uid: "another" } }); b.args[1]({ calendarWeekStartsOnMonday: true }); h.render();
  assert.equal(s.screen("Settings").calendarSettingsReady, false); assert.equal(s.screen("Calendar").calendarFirstDay, 0);
  await tick(); h.unmount();
});

test("a week-start change does not trigger loading-summary rebuilds or extra backend reads", async () => {
  const { createLoadingOptimizationBackend } = require("../../functions/loadingOptimizationBackend");
  let reads = 0;
  const backend = createLoadingOptimizationBackend({ firestore: { collection() { reads++; throw new Error("Unexpected read"); } } });
  await backend.handleTeam({ params: { teamId: "a" }, data: {
    before: { data: () => ({ channels: ["General"], calendarWeekStartsOnMonday: false }) },
    after: { exists: true, data: () => ({ channels: ["General"], calendarWeekStartsOnMonday: true }) },
  } });
  assert.equal(reads, 0);
});
