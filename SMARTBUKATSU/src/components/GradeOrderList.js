import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, View, TouchableOpacity, StyleSheet, Alert, Keyboard } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const move = (values, from, to) => {
  const next = [...values], [value] = next.splice(from, 1);next.splice(to, 0, value);return next;
};

function GradeRow({ grade, locked, dragging, interacting, shift, handlers, menu, onEdit, onDelete, onLayout }) {
  const gesture = useMemo(() => Gesture.Pan().enabled(!locked).activateAfterLongPress(350).maxPointers(1).runOnJS(true)
    .onStart(event => handlers.current.start(grade, event))
    .onUpdate(event => handlers.current.update(grade, event))
    .onFinalize((_event, success) => handlers.current.finish(grade, success)), [grade, locked, handlers]);
  return <Animated.View onLayout={onLayout} style={[menu.memberItem, { transform: [{ translateY: shift }] }, dragging && styles.dragging]}>
    <GestureDetector gesture={gesture}>
      <View style={styles.handle} accessible accessibilityRole="adjustable" accessibilityLabel={`${grade}の表示順`}
        accessibilityHint="長押しして上下に動かすか、上下の調整操作で並べ替えます。"
        accessibilityState={{ disabled: locked }} accessibilityActions={[{ name: 'increment', label: '下へ移動' }, { name: 'decrement', label: '上へ移動' }]}
        onAccessibilityAction={event => handlers.current.adjust(grade, event.nativeEvent.actionName)}>
        <Text style={[styles.grip, locked && styles.disabled]}>≡</Text><Text style={[menu.memberName, styles.name]}>{grade}</Text>
      </View>
    </GestureDetector>
    <TouchableOpacity disabled={locked || interacting} style={[menu.subSettingBadge, styles.edit]} accessibilityLabel={`${grade}を編集`} onPress={() => onEdit(grade)}>
      <Text style={menu.subSettingText}>編集 ▾</Text>
    </TouchableOpacity>
    <TouchableOpacity disabled={locked || interacting} onPress={() => onDelete(grade)}><Text style={menu.deleteText}>削除</Text></TouchableOpacity>
  </Animated.View>;
}

export default function GradeOrderList({ grades, disabled = false, onReorder, onEdit, onDelete, menuStyles: menu,
  scrollRef, scrollStateRef, onDraggingChange, onBusyChange }) {
  const [drag, setDrag] = useState(null), [draft, setDraft] = useState(null), [saving, setSaving] = useState(false);
  const animatedY = useRef(new Animated.Value(0)).current;
  const heights = useRef(new Map()), active = useRef(null), timer = useRef(null), alive = useRef(true), pending = useRef(false), handlers = useRef({});
  const latest = useRef(null), signature = JSON.stringify(grades);
  latest.current = { grades, signature, disabled, onReorder, onDraggingChange, onBusyChange };
  const stop = () => { if (timer.current !== null) clearInterval(timer.current);timer.current = null; };
  const clear = () => {
    stop();active.current = null;animatedY.setValue(0);setDrag(null);
    latest.current.onDraggingChange?.(false);
  };
  const save = async (before, after) => {
    if (pending.current || !alive.current) return;
    pending.current = true;
    setDraft({ base: JSON.stringify(before), grades: after });setSaving(true);latest.current.onBusyChange?.(true);
    try { await latest.current.onReorder(before, after); }
    catch (error) {
      if (alive.current) { setDraft(null);Alert.alert('表示順を保存できませんでした', error.message || '通信状態を確認して、もう一度お試しください。'); }
    } finally { pending.current = false;if (alive.current) { setSaving(false);latest.current.onBusyChange?.(false); } }
  };
  const update = () => {
    const value = active.current;if (!value) return;
    const offset = (scrollStateRef?.current?.offset || 0) - value.startScroll;
    const y = Math.max(-value.top, Math.min(value.total - value.top - value.height, value.translation + offset));
    animatedY.setValue(y);
    const top = value.top + y;
    let to = value.from;
    if (y > 0) while (to < value.centers.length - 1 && top >= value.centers[to + 1] - value.height) to++;
    if (y < 0) while (to > 0 && top <= value.centers[to - 1]) to--;
    if (to !== value.to) { value.to = to;setDrag({ grade: value.grade, from: value.from, to, height: value.height }); }
  };
  handlers.current = {
    start(grade, event) {
      if (disabled || pending.current || active.current) return;
      const from = grades.indexOf(grade);if (from < 0 || grades.length < 2) return;
      Keyboard.dismiss();
      let total = 0;
      const centers = grades.map(name => { const height = heights.current.get(name) || 60, center = total + height / 2;total += height;return center; });
      const height = heights.current.get(grade) || 60;
      active.current = { grade, from, to: from, top: centers[from] - height / 2, height, total, centers,
        grades: [...grades], signature, translation: 0, absoluteY: event.absoluteY, startScroll: scrollStateRef?.current?.offset || 0 };
      setDraft(null);setDrag({ grade, from, to: from, height });onDraggingChange?.(true);onBusyChange?.(true);
      scrollRef?.current?.measureInWindow?.((_x, top, _width, viewportHeight) => {
        if (scrollStateRef?.current) Object.assign(scrollStateRef.current, { top, height: viewportHeight });
      });
      timer.current = setInterval(() => {
        const value = active.current, scroll = scrollStateRef?.current;
        if (!value || !scroll || !scroll.height) return;
        const edge = Math.min(64, scroll.height / 4), localY = value.absoluteY - scroll.top;
        const step = localY < edge ? -12 * Math.min(1, (edge - localY) / edge)
          : localY > scroll.height - edge ? 12 * Math.min(1, (localY - scroll.height + edge) / edge) : 0;
        const movement = value.translation + scroll.offset - value.startScroll;
        if ((step < 0 && movement <= -value.top) || (step > 0 && movement >= value.total - value.top - value.height)) return;
        const next = Math.max(0, Math.min(Math.max(0, scroll.contentHeight - scroll.height), scroll.offset + step));
        if (next === scroll.offset) return;
        scroll.offset = next;scrollRef?.current?.scrollTo({ y: next, animated: false });update();
      }, 16);
    },
    update(grade, event) {
      if (active.current?.grade !== grade) return;
      active.current.translation = event.translationY;active.current.absoluteY = event.absoluteY;update();
    },
    finish(grade, success) {
      const value = active.current;if (!value || value.grade !== grade) return;
      clear();
      if (success && !latest.current.disabled && value.signature === latest.current.signature && value.from !== value.to) void save(value.grades, move(value.grades, value.from, value.to));
      else latest.current.onBusyChange?.(false);
    },
    adjust(grade, action) {
      if (disabled || pending.current || active.current || !['increment', 'decrement'].includes(action)) return;
      const from = grades.indexOf(grade), to = from + (action === 'increment' ? 1 : -1);
      if (from >= 0 && to >= 0 && to < grades.length) void save([...grades], move(grades, from, to));
    },
  };
  useEffect(() => {
    if (active.current) { clear();onBusyChange?.(false); }
    setDraft(null);
  }, [signature, disabled]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false;stop();active.current = null;latest.current.onDraggingChange?.(false);latest.current.onBusyChange?.(false); };
  }, []);
  const ordered = draft?.base === signature ? draft.grades : grades;
  return <View>
    {!!grades.length && <Text style={styles.hint}>{saving ? '表示順を保存中…' : '≡ または名前を長押しして上下に動かすと、表示順を保存します。'}</Text>}
    <View style={menu.memberList}>
      {ordered.map((grade, index) => {
        const dragging = drag?.grade === grade;
        const shifted = drag && (drag.from < drag.to && index > drag.from && index <= drag.to ? -drag.height
          : drag.from > drag.to && index >= drag.to && index < drag.from ? drag.height : 0);
        return <GradeRow key={grade} grade={grade} locked={disabled || saving} dragging={Boolean(dragging)} interacting={Boolean(drag)} shift={dragging ? animatedY : shifted || 0}
          handlers={handlers} menu={menu} onEdit={onEdit} onDelete={onDelete}
          onLayout={event => heights.current.set(grade, event.nativeEvent.layout.height)} />;
      })}
      {!grades.length && <Text style={menu.emptyText}>登録がありません</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, lineHeight: 18, color: '#666', marginBottom: 10 },
  handle: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44, marginVertical: -10, marginLeft: -8, paddingLeft: 8, paddingVertical: 10, paddingRight: 8 },
  grip: { fontSize: 24, color: '#888', marginRight: 10 },name: { flex: 1, marginBottom: 0 },edit: { marginRight: 12 },disabled: { opacity: 0.4 },
  dragging: { zIndex: 10, elevation: 5, backgroundColor: '#ebf5fb', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4 },
});
