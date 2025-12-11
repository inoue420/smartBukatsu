import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { subscribeVideos } from '../services/firestoreService';

export default function VideoListScreen({ navigation }) {
  const [videos, setVideos] = useState([]);

  useEffect(() => {
    const unsub = subscribeVideos(setVideos);
    return () => unsub();
  }, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('AddVideo')}>
        <Text style={styles.addBtnText}>＋ 動画追加</Text>
      </TouchableOpacity>

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Tagging', { videoId: item.id })}
            onLongPress={() => navigation.navigate('Highlights', { videoId: item.id })}
          >
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{item.videoUrl}</Text>
            <Text style={styles.hint}>タップ：タグ付け / 長押し：ハイライト再生</Text>
          </TouchableOpacity>
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
  hint: { marginTop: 8, color: '#0077cc' }
});
