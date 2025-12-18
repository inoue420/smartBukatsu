import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, TextInput } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  subscribeVideos,
  deleteVideo,
  subscribeTags,
  upsertTag,
  deleteTag,
  removeTagFromAllEvents,
} from '../services/firestoreService';

function splitTags(text) {
  return String(text || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function VideoListScreen({ navigation }) {
  const [videos, setVideos] = useState([]);
  const swipeRefs = useRef(new Map());

  // ✅ 共通タグ（全動画に適用）
  const [tagText, setTagText] = useState('');
  const [tags, setTags] = useState([]);

  useEffect(() => {
    const unsub = subscribeVideos(setVideos);
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeTags(setTags);
    return () => unsub?.();
  }, []);

  const closeRow = useCallback((id) => {
    swipeRefs.current.get(id)?.close();
  }, []);

  const confirmDelete = useCallback((video) => {
    Alert.alert(
      '削除しますか？',
      `「${video.title}」を削除します。\n（この動画のイベント（記録）は削除されます / 共通タグ一覧は残ります）`,
      [
        { text: 'キャンセル', style: 'cancel', onPress: () => closeRow(video.id) },
        {
          text: 'はい（削除）',
          style: 'destructive',
          onPress: async () => {
            closeRow(video.id);
            try {
              await deleteVideo(video.id);
              // subscribeVideos が購読しているので一覧は自動で更新されます
            } catch (e) {
              console.error('delete failed:', e);
              const msg =
                (e?.code ? `code: ${e.code}\n` : '') +
                (e?.message ? `message: ${e.message}\n` : '') +
                (e?.name ? `name: ${e.name}\n` : '') +
                `raw: ${String(e)}`;
              Alert.alert('削除に失敗しました', msg);
            }
          },
        },
      ]
    );
  }, [closeRow]);

  const handleRegisterTags = useCallback(async () => {
    const names = splitTags(tagText);
    if (!names.length) {
      Alert.alert('タグ未入力', 'タグを入力してください（例：シュート,10番）');
      return;
    }
    try {
      await Promise.all(names.map((n) => upsertTag(n)));
      setTagText('');
    } catch (e) {
      Alert.alert('エラー', 'タグ登録に失敗しました');
    }
  }, [tagText]);

  const confirmDeleteTag = useCallback((name) => {
    Alert.alert(
      'タグ削除（全動画共通）',
      `「${name}」を削除しますか？\n※全ての動画の記録からも削除されます`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTag(name);
              await removeTagFromAllEvents(name);
            } catch (e) {
              Alert.alert('エラー', 'タグ削除に失敗しました');
            }
          },
        },
      ]
    );
  }, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('AddVideo')}>
        <Text style={styles.addBtnText}>＋ 動画追加</Text>
      </TouchableOpacity>

      <FlatList
        style={{ flex: 1 }}
        data={videos}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Swipeable
            ref={(ref) => {
              if (ref) swipeRefs.current.set(item.id, ref);
              else swipeRefs.current.delete(item.id);
            }}
            overshootRight={false}
            rightThreshold={40}
            renderRightActions={() => (
              <TouchableOpacity
                style={styles.deleteAction}
                activeOpacity={0.8}
                onPress={() => confirmDelete(item)}
              >
                <Text style={styles.deleteActionText}>削除</Text>
              </TouchableOpacity>
            )}
            onSwipeableOpen={(direction) => {
              if (direction === 'right') confirmDelete(item); // 右アクションが開いた時だけ
            }}
          >
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('Tagging', { videoId: item.id })}
              onLongPress={() => navigation.navigate('Highlights', { videoId: item.id })}
            >
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{item.videoUrl}</Text>
              <Text style={styles.hint}>タップ：タグ付け / 長押し：ハイライト再生</Text>
            </TouchableOpacity>
          </Swipeable>
        )}
        ListEmptyComponent={<Text>動画がありません。「＋動画追加」から登録してください。</Text>}
      />

      {/* ✅ 画面下部：共通タグ登録 */}
      <View style={styles.tagArea}>
        <Text style={styles.label}>共通タグ登録（全動画に適用 / カンマ区切りOK）</Text>
        <View style={styles.tagRegisterRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={tagText}
            onChangeText={setTagText}
            placeholder="例）シュート,10番 / パスミス / GK"
          />
          <TouchableOpacity style={styles.confirmBtn} onPress={handleRegisterTags}>
            <Text style={styles.confirmBtnText}>確定</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.label, { marginTop: 10 }]}>共通タグ一覧（長押しで削除）</Text>
        <View style={styles.tagButtonsWrap}>
          {tags.length === 0 ? (
            <Text style={styles.small}>まだタグが登録されていません</Text>
          ) : (
            tags.map((t) => {
              const name = t?.name;
              if (!name) return null;
              return (
                <TouchableOpacity
                  key={t.id || name}
                  style={[styles.tagBtn, styles.tagBtnInactive]}
                  onLongPress={() => confirmDeleteTag(name)}
                >
                  <Text style={[styles.tagBtnText, styles.tagBtnTextInactive]}>{name}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF', padding: 12 },
  addBtn: { padding: 12, backgroundColor: '#0077cc', borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  addBtnText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 10 },
  title: { fontWeight: 'bold', fontSize: 16 },
  subtitle: { color: '#555', marginTop: 4 },
  hint: { marginTop: 8, color: '#0077cc' },
  deleteAction: {
    backgroundColor: '#d11a2a',
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    borderRadius: 8,
    marginBottom: 10,
  },
  deleteActionText: { color: '#fff', fontWeight: 'bold' },

  // ✅ 下部タグUI
  tagArea: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#bfefff' },
  label: { fontWeight: 'bold' },
  input: { backgroundColor: '#fff', padding: 10, borderRadius: 8, marginTop: 6 },
  small: { marginTop: 6, color: '#333' },
  tagRegisterRow: { flexDirection: 'row', alignItems: 'center' },
  confirmBtn: { marginTop: 6, marginLeft: 8, backgroundColor: '#0077cc', borderRadius: 8, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  confirmBtnText: { color: '#fff', fontWeight: 'bold' },
  tagButtonsWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  tagBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, marginRight: 8, marginBottom: 8 },
  tagBtnInactive: { backgroundColor: '#fff', borderColor: '#0077cc' },
  tagBtnText: { fontWeight: 'bold' },
  tagBtnTextInactive: { color: '#0077cc' },  
});
