import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { subscribeVideos, deleteVideo } from '../services/firestoreService';

export default function VideoListScreen({ navigation }) {
  const [videos, setVideos] = useState([]);
  const swipeRefs = useRef(new Map());

  useEffect(() => {
    const unsub = subscribeVideos(setVideos);
    return () => unsub();
  }, []);

  const closeRow = useCallback((id) => {
    swipeRefs.current.get(id)?.close();
  }, []);

  const confirmDelete = useCallback((video) => {
    Alert.alert(
      '削除しますか？',
      `「${video.title}」を削除します。\n（タグも削除されます）`,
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

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('AddVideo')}>
        <Text style={styles.addBtnText}>＋ 動画追加</Text>
      </TouchableOpacity>

      <FlatList
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
});
