import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { subscribeVideos, getProjectVideos, addVideoToProject } from '../services/firestoreService';

export default function ProjectVideoPickerScreen({ route, navigation }) {
  const { projectId } = route.params;
  const { activeTeamId, isAdmin, user } = useAuth();
  const [videos, setVideos] = useState([]);
  const [existing, setExisting] = useState(new Map()); // videoId -> {order,...}
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    if (!activeTeamId) return;
    const unsub = subscribeVideos(activeTeamId, setVideos);
    return () => unsub?.();
  }, [activeTeamId]);

  useEffect(() => {
    (async () => {
      if (!activeTeamId) return;
      const rows = await getProjectVideos(activeTeamId, projectId);
      const m = new Map();
      rows.forEach((r) => m.set(r.id, r));
      setExisting(m);
    })();
  }, [activeTeamId, projectId]);

  const maxOrder = useMemo(() => {
    let m = -1;
    existing.forEach((v) => {
      const o = typeof v.order === 'number' ? v.order : 0;
      if (o > m) m = o;
    });
    return m;
  }, [existing]);

  const toggle = useCallback(
    (videoId) => {
      if (existing.has(videoId)) return; // 既に追加済みは触れない（MVP）
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(videoId)) next.delete(videoId);
        else next.add(videoId);
        return next;
      });
    },
    [existing]
  );

  const onAdd = useCallback(async () => {
    if (!isAdmin) {
      Alert.alert('権限がありません', 'プロジェクト編集は管理者のみ可能です');
      return;
    }
    const ids = Array.from(selected);
    if (!ids.length) {
      Alert.alert('未選択', '追加する動画を選択してください');
      return;
    }
    try {
      let order = maxOrder + 1;
      for (const vid of ids) {
        await addVideoToProject(activeTeamId, projectId, vid, { order, offsetSec: 0, addedBy: user.uid });
        order += 1;
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert('エラー', e?.message ? String(e.message) : String(e));
    }
  }, [isAdmin, selected, maxOrder, activeTeamId, projectId, user?.uid]);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={[styles.btn, { opacity: isAdmin ? 1 : 0.5 }]} onPress={onAdd}>
        <Text style={styles.btnText}>選択した動画を追加（{selected.size}）</Text>
      </TouchableOpacity>

      <FlatList
        data={videos}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => {
          const already = existing.has(item.id);
          const on = selected.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.card, already && styles.cardDisabled, on && styles.cardSelected]}
              onPress={() => toggle(item.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.title}>
                {already ? '✅ ' : on ? '☑️ ' : '⬜ '}
                {item.title}
              </Text>
              <Text style={styles.small} numberOfLines={1}>{item.videoUrl}</Text>
              {already && <Text style={styles.small}>（追加済み）</Text>}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={{ padding: 12 }}>動画がありません</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF', padding: 12 },
  btn: { backgroundColor: '#009966', padding: 12, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  btnText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 10 },
  cardSelected: { borderWidth: 2, borderColor: '#009966' },
  cardDisabled: { opacity: 0.6 },
  title: { fontWeight: 'bold', fontSize: 16 },
  small: { marginTop: 4, color: '#555' },
});
