import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { getProject, subscribeProjectVideos, subscribeVideos, removeVideoFromProject } from '../services/firestoreService';

export default function ProjectDetailScreen({ route, navigation }) {
  const { projectId } = route.params;
  const { activeTeamId, isAdmin } = useAuth();
  const [project, setProject] = useState(null);
  const [projectVideos, setProjectVideos] = useState([]); // [{id(videoId), order, offsetSec}]
  const [allVideos, setAllVideos] = useState([]); // team videos

  useEffect(() => {
    (async () => {
      if (!activeTeamId) return;
      const p = await getProject(activeTeamId, projectId);
      setProject(p);
      navigation.setOptions({ title: p?.name ? `プロジェクト：${p.name}` : 'プロジェクト詳細' });
    })();
  }, [activeTeamId, projectId]);

  useEffect(() => {
    if (!activeTeamId) return;
    const unsub = subscribeProjectVideos(activeTeamId, projectId, setProjectVideos);
    return () => unsub?.();
  }, [activeTeamId, projectId]);

  useEffect(() => {
    if (!activeTeamId) return;
    const unsub = subscribeVideos(activeTeamId, setAllVideos);
    return () => unsub?.();
  }, [activeTeamId]);

  const videoById = useMemo(() => {
    const m = new Map();
    allVideos.forEach((v) => m.set(v.id, v));
    return m;
  }, [allVideos]);

  const rows = useMemo(() => {
    return projectVideos
      .map((pv) => {
        const v = videoById.get(pv.id);
        return { ...pv, video: v || null };
      })
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [projectVideos, videoById]);

  const onRemove = useCallback(
    (videoId, title) => {
      if (!isAdmin) {
        Alert.alert('権限がありません', 'プロジェクト編集は管理者のみ可能です');
        return;
      }
      Alert.alert('削除しますか？', `このプロジェクトから「${title || videoId}」を外します`, [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '外す',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeVideoFromProject(activeTeamId, projectId, videoId);
            } catch (e) {
              Alert.alert('エラー', e?.message ? String(e.message) : String(e));
            }
          },
        },
      ]);
    },
    [isAdmin, activeTeamId, projectId]
  );

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: '#0077cc', opacity: rows.length ? 1 : 0.5 }]}
          onPress={() => rows.length && navigation.navigate('ProjectHighlights', { projectId })}
        >
          <Text style={styles.btnText}>▶ ハイライト</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: '#009966', opacity: isAdmin ? 1 : 0.5 }]}
          onPress={() =>
            isAdmin
              ? navigation.navigate('ProjectVideoPicker', { projectId })
              : Alert.alert('権限がありません', 'プロジェクト編集は管理者のみ可能です')
          }
        >
          <Text style={styles.btnText}>＋ 動画を追加</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => item.video && navigation.navigate('Tagging', { videoId: item.id })}
            onLongPress={() => onRemove(item.id, item.video?.title)}
          >
            <Text style={styles.title}>
              {item.order ?? 0}. {item.video?.title || '(動画が見つかりません)'}
            </Text>
            <Text style={styles.small} numberOfLines={1}>
              {item.video?.videoUrl || item.id}
            </Text>
            <Text style={styles.hint}>タップ：タグ付け / 長押し：プロジェクトから外す</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ padding: 12 }}>このプロジェクトにはまだ動画がありません</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF', padding: 12 },
  topRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 10 },
  title: { fontWeight: 'bold', fontSize: 16 },
  small: { marginTop: 4, color: '#555' },
  hint: { marginTop: 8, color: '#0077cc' },
});
