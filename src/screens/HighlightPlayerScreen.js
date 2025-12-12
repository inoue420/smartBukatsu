import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, Alert } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { getVideo, subscribeEvents } from '../services/firestoreService';
import { PLAYBACK_MARGIN_START, PLAYBACK_MARGIN_END } from '../constants';

export default function HighlightPlayerScreen({ route, navigation }) {
  const { videoId } = route.params;
  const videoRef = useRef(null);
  const [video, setVideo] = useState(null);
  const [events, setEvents] = useState([]);
  const [filterText, setFilterText] = useState('シュート,10番'); // 例
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);

  useEffect(() => {
    (async () => {
      const v = await getVideo(videoId);
      if (!v) {
        Alert.alert('エラー', '動画が見つかりません');
        navigation.goBack();
        return;
      }
      setVideo(v);
      navigation.setOptions({ title: `ハイライト：${v.title}` });
    })();
  }, [videoId]);

  useEffect(() => {
    const unsub = subscribeEvents(videoId, setEvents);
    return () => unsub();
  }, [videoId]);

  const activeTags = useMemo(() => {
    return filterText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }, [filterText]);

  const filtered = useMemo(() => {
    if (!activeTags.length) return [];
    const ok = events.filter(e =>
      activeTags.every(t => (e.tagTypes || []).includes(t))
    );
    return ok.sort((a, b) => a.startSec - b.startSec);
  }, [events, activeTags]);

  useEffect(() => {
    setPlaylist(filtered);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
  }, [filtered]);

  useEffect(() => {
    // クリップ変わったらシーク
    const clip = playlist[currentIndex];
    if (!clip || !videoRef.current) return;
    (async () => {
      await videoRef.current.setStatusAsync({
        positionMillis: Math.max(clip.startSec - PLAYBACK_MARGIN_START, 0) * 1000,
        shouldPlay: true,
      });
    })();
    currentIndexRef.current = currentIndex;
  }, [currentIndex, playlist]);

  const handleStatusUpdate = (status) => {
    if (!status.isLoaded || !status.isPlaying) return;
    const idx = currentIndexRef.current;
    const clip = playlist[idx];
    if (!clip) return;

    const posSec = status.positionMillis / 1000;
    if (posSec >= clip.endSec - PLAYBACK_MARGIN_END) {
      const nextIndex = idx + 1;
      const nextClip = playlist[nextIndex];
      if (nextClip) {
        currentIndexRef.current = nextIndex;
        setCurrentIndex(nextIndex);
        videoRef.current.setStatusAsync({
          positionMillis: Math.max(nextClip.startSec - PLAYBACK_MARGIN_START, 0) * 1000,
          shouldPlay: true,
        });
      } else {
        // 最後まで再生したら停止
        videoRef.current.setStatusAsync({ shouldPlay: false });
      }
    }
  };

  const playFrom = (index) => {
    if (!playlist[index]) return;
    currentIndexRef.current = index;
    setCurrentIndex(index);
  };

  return (
    <View style={styles.container}>
      {video && (
        <>
          <Video
            ref={videoRef}
            source={{ uri: video.videoUrl }}
            style={styles.video}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            onPlaybackStatusUpdate={handleStatusUpdate}
          />

          <View style={styles.filterRow}>
            <Text style={styles.label}>タグ（AND, カンマ区切り）</Text>
            <TextInput
              style={styles.input}
              value={filterText}
              onChangeText={setFilterText}
              placeholder="例）シュート,10番"
            />
            <Text style={styles.small}>一致: {playlist.length} 件</Text>
          </View>

          <FlatList
            data={playlist}
            keyExtractor={(e) => e.id}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={[styles.clipItem, index === currentIndex && styles.clipItemActive]}
                onPress={() => playFrom(index)}
              >
                <Text style={styles.clipText}>
                  #{index + 1} [{item.startSec.toFixed(1)}s - {item.endSec.toFixed(1)}s] {item.tagTypes?.join(', ')}
                </Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
            ListEmptyComponent={<Text style={{ padding: 8 }}>条件に一致するクリップがありません</Text>}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF' },
  video: { width: '100%', height: 220, backgroundColor: '#000' },
  filterRow: { padding: 12 },
  label: { fontWeight: 'bold' },
  input: { backgroundColor: '#fff', padding: 10, borderRadius: 8, marginTop: 6 },
  small: { marginTop: 6, color: '#333' },
  clipItem: { backgroundColor: '#fff', padding: 10, borderRadius: 6, marginVertical: 4 },
  clipItemActive: { borderWidth: 2, borderColor: '#0077cc' },
  clipText: { color: '#333' },
});
