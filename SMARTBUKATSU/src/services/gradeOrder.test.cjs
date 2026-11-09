const test = require('node:test'), assert = require('node:assert/strict');
const { load, loadGradeOrderService, renderHarness, screenHarness } = require('../../scripts/calendarWeekStartTestHarness.cjs');
const plain = value => JSON.parse(JSON.stringify(value)), tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject;const promise = new Promise((yes, no) => { resolve = yes;reject = no; });return { promise, resolve, reject }; };
function service(team = { grades: ['A', 'B', 'C'], channels: [{ id: 'existing' }] }) {
  const calls = [], writes = [];let current = team;
  const save = loadGradeOrderService('synthetic', {
    doc: (...args) => args,
    runTransaction: async (_db, run) => {
      calls.push('transaction');const pending = [];
      const result = await run({ get: async ref => { calls.push(ref);return { exists: () => current !== null, data: () => current }; },
        update: (ref, data) => pending.push({ ref, data }) });
      for (const write of pending) { writes.push(write);current = { ...current, ...write.data }; }return result;
    },
  });
  return { save, calls, writes, get team() { return current; } };
}
test('saving grade order writes only the team array once; unchanged and invalid moves do not access Firestore', async () => {
  const s = service();assert.equal(await s.save('team', ['A','B','C'], ['A','B','C']), false);assert.equal(s.calls.length, 0);
  for (const after of [['B','C'], ['A','A','C'], ['A','B','D'], ['A','B',' '], null]) await assert.rejects(s.save('team', ['A','B','C'], after));
  assert.equal(s.calls.length, 0);
  assert.equal(await s.save('team', ['A','B','C'], ['C','A','B']), true);
  assert.equal(s.writes.length, 1);assert.equal(s.calls.length, 2);assert.deepEqual(s.writes[0].data, { grades: ['C','A','B'] });
  assert.deepEqual(s.team.channels, [{ id: 'existing' }]);
});
test('concurrent additions, removals, renames, reorders and graduation locks are never overwritten', async () => {
  for (const grades of [['A','B','C','D'], ['A','C'], ['Renamed','B','C'], ['B','A','C'], []]) {
    const s = service({ grades });await assert.rejects(s.save('team', ['A','B','C'], ['C','A','B']), /更新されました/);assert.equal(s.writes.length, 0);
  }
  const pending = service({ grades: ['A','B','C'], membershipBatchPending: true });
  await assert.rejects(pending.save('team', ['A','B','C'], ['C','A','B']), /一括処理/);assert.equal(pending.writes.length, 0);
  await assert.rejects(service(null).save('missing', ['A','B'], ['B','A']), /見つかりません/);
});
test('legacy grade defaults remain compatible and an explicitly empty catalog stays empty', async () => {
  for (const old of [{}, { grades: null }]) {
    const s = service(old);await s.save('team', ['1年生','2年生','3年生'], ['3年生','1年生','2年生']);
    assert.deepEqual(s.team.grades, ['3年生','1年生','2年生']);
  }
  const empty = service({ grades: [] });await assert.rejects(empty.save('team', ['1年生','2年生','3年生'], ['3年生','1年生','2年生']));assert.equal(empty.writes.length, 0);
});

function environment(overrides = {}) {
  const h = renderHarness(), calls = [], alerts = [], states = [], timers = new Map();let timerId = 0;
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } }
  const native = { Animated: { Value, View: 'AnimatedView' }, View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
    StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) }, Keyboard: { dismiss() {} } };
  const modules = { react: h.react, 'react-native': native, 'react-native-gesture-handler': { Gesture: {}, GestureDetector: 'GestureDetector' } };
  const Component = load('src/components/GradeOrderList.js', modules, '', {
    setInterval: callback => { timers.set(++timerId, callback);return timerId; }, clearInterval: id => timers.delete(id),
  }).default;
  let props = { grades: ['A','B','C'], menuStyles: {},
    onReorder: async (before, after) => { calls.push(plain({ before, after }));props = { ...props, grades: after }; },
    onEdit() {}, onDelete() {}, onDraggingChange: value => states.push(['drag',value]), onBusyChange: value => states.push(['busy',value]),
    scrollStateRef: { current: { offset: 0, top: 0, height: 400, contentHeight: 1000 } }, ...overrides };
  h.mount(() => Component(props));
  const rows = () => h.all(node => node.props?.grade && node.props?.handlers);
  const row = grade => rows().find(node => node.props.grade === grade);
  const controller = () => rows()[0].props.handlers.current;
  rows().forEach(node => node.props.onLayout({ nativeEvent: { layout: { height: 60 } } }));
  return { h, calls, alerts, states, rows, row, controller, timers,
    start(grade) { controller().start(grade, { absoluteY: 150 });h.update(); },
    move(grade, y) { controller().update(grade, { translationY: y, absoluteY: 150 + y });h.update(); },
    finish(grade, success = true) { controller().finish(grade, success);h.update(); },
    change(values) { props = { ...props, ...values };h.update(); },
    get props() { return props; }, native };
}
test('dragging previews movement locally and saves one final order after release', async () => {
  const e = environment();e.start('A');e.move('A', 75);e.move('A', 140);
  assert.equal(e.calls.length, 0);assert.equal(e.row('A').props.dragging, true);assert.equal(e.row('B').props.shift, -60);
  e.finish('A');e.finish('A');await tick();e.h.update();
  assert.deepEqual(e.calls, [{ before: ['A','B','C'], after: ['B','C','A'] }]);
  assert.deepEqual(e.rows().map(row => row.props.grade), ['B','C','A']);
  assert.equal(e.states.at(-1)[1], false);e.h.unmount();
});
test('cancellation, returning to the same position and a changed remote catalog never save', () => {
  for (const action of ['cancel','unchanged','remote','permission']) {
    const e = environment();e.start('B');e.move('B', 70);
    if (action === 'unchanged') e.move('B', 0);
    if (action === 'remote') e.change({ grades: ['A','Renamed','C'] });
    if (action === 'permission') e.change({ disabled: true });
    e.finish('B', action !== 'cancel');assert.equal(e.calls.length, 0);assert.equal(e.states.at(-1)[1], false);e.h.unmount();
  }
});
test('measured row heights and parent scrolling determine the drop target', async () => {
  const e = environment();
  e.row('A').props.onLayout({ nativeEvent: { layout: { height: 100 } } });
  e.start('A');e.props.scrollStateRef.current.offset = 150;e.move('A', 0);e.finish('A');await tick();e.h.update();
  assert.deepEqual(e.calls[0].after, ['B','C','A']);e.h.unmount();
  const up = environment();up.row('A').props.onLayout({ nativeEvent: { layout: { height: 100 } } });
  up.start('C');up.move('C', -200);up.finish('C');await tick();up.h.update();
  assert.deepEqual(up.calls[0].after, ['C','A','B']);up.h.unmount();
});
test('failed saves restore the current order and pending writes block repeated accessibility actions', async () => {
  const pending = deferred(), e = environment({ onReorder: () => pending.promise });
  e.controller().adjust('A','increment');e.controller().adjust('A','increment');e.h.update();
  assert.equal(e.rows().every(row => row.props.locked), true);
  assert.deepEqual(e.rows().map(row => row.props.grade), ['B','A','C']);
  pending.reject(new Error('offline'));await tick();e.h.update();
  assert.deepEqual(e.rows().map(row => row.props.grade), ['A','B','C']);assert.equal(e.alerts.length, 1);
  assert.equal(e.rows().every(row => !row.props.locked), true);e.h.unmount();
});
test('edge scrolling runs only during a drag, stops at the list boundary and never writes before release', async () => {
  const scrolls = [], e = environment({ scrollRef: { current: {
    measureInWindow: callback => callback(0,100,400,400), scrollTo: value => scrolls.push(value),
  } } });
  assert.equal(e.timers.size, 0);e.start('B');assert.equal(e.timers.size, 1);
  e.controller().update('B', { translationY: 0, absoluteY: 490 });
  const pulse = [...e.timers.values()][0];for (let i = 0; i < 100; i++) pulse();e.h.update();
  assert.ok(scrolls.length > 0);assert.ok(scrolls.at(-1).y < 80);assert.equal(e.calls.length, 0);
  e.finish('B');assert.equal(e.timers.size, 0);const count = scrolls.length;pulse();assert.equal(scrolls.length, count);
  await tick();e.h.update();assert.deepEqual(e.calls[0].after, ['A','C','B']);e.h.unmount();
});
test('disabled lists and late responses after unmount cannot move rows or display stale errors', async () => {
  const locked = environment({ disabled: true });locked.start('A');locked.move('A', 150);locked.finish('A');locked.controller().adjust('A','increment');
  assert.equal(locked.calls.length, 0);locked.h.unmount();
  const pending = deferred(), e = environment({ onReorder: () => pending.promise });e.start('A');e.move('A', 150);e.finish('A');e.h.unmount();
  pending.reject(new Error('late failure'));await tick();assert.equal(e.alerts.length, 0);
});
test('row gestures require a long press, stay on JS and distinguish cancellation from a drop', () => {
  const h = renderHarness(), calls = [], configurations = [];
  const Gesture = { Pan: () => {
    const config = {}, gesture = {};
    for (const name of ['enabled','activateAfterLongPress','maxPointers','runOnJS','onStart','onUpdate','onFinalize']) gesture[name] = value => { config[name] = value;return gesture; };
    configurations.push(config);return gesture;
  } };
  const native = environment().native;
  const { GradeRow } = load('src/components/GradeOrderList.js', { react: h.react, 'react-native': native,
    'react-native-gesture-handler': { Gesture, GestureDetector: 'GestureDetector' } }, '\nexport { GradeRow };');
  h.mount(() => GradeRow({ grade: 'A', locked: false, menu: {}, handlers: { current: { start: (...args) => calls.push(args), update() {}, finish: (...args) => calls.push(args) } } }));
  const config = configurations[0];assert.equal(config.activateAfterLongPress, 350);assert.equal(config.runOnJS, true);assert.equal(config.maxPointers, 1);
  config.onStart({ absoluteY: 20 });config.onFinalize({}, false);assert.equal(calls[1][1], false);h.unmount();
});
for (const os of ['android','ios']) test(`${os}: Settings persists order for the selected team and ignores a completed save after team switching`, async () => {
  const writes = [], saved = [], pending = deferred();
  const s = screenHarness('SettingsScreen', { grades: ['A','B'], setGrades: value => saved.push(value) },
    { reorderTeamGrades: async (...args) => { writes.push(args);await pending.promise; } }, os);
  const list = () => s.h.find(node => node.type === '../components/GradeOrderList');
  assert.equal(list().props.disabled, false);
  const save = list().props.onReorder(['A','B'], ['B','A']);
  assert.equal(writes[0][0], 'a');s.change({}, { activeTeamId: 'b' });pending.resolve();await save;
  assert.equal(saved.length, 0);
  s.change({ membershipBatchPending: true });assert.equal(list().props.disabled, true);
  await assert.rejects(list().props.onReorder(['A','B'], ['B','A']));assert.equal(writes.length, 1);s.h.unmount();
});
