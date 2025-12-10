import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { getVideo, subscribeEvents, addEvent } from '../services/firestoreService';
import { TAG_PRESETS } from '../constants';

export default function TaggingScreen({ route, navigation }) {
  const { videoId } = route.params;
  const [video, setVideo] = useState(null);
  const [events, setEvents] = useState([]);
  const [currentTag, setCurrentTag] = useState(TAG_PRESETS[0]);
  const [pendingStart, setPendingStart] = useState(null);
  const videoRef = useRef(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const v = await getVideo(videoId);
      if (!v) {
        Alert.alert('エラー', '動画が見つかりませんでした');
        navigation.goBack();
        return;
      }
      setVideo(v);
      navigation.setOptions({ title: `タグ付け：${v.title}` });
    })();
  }, [videoId]);

  useEffect(() => {
    const unsub = subscribeEvents(videoId, setEvents);
    return () => unsub();
  }, [videoId]);

  const handleStart = () => {
    if (!status?.isLoaded) return;
    setPendingStart(status.positionMillis / 1000);
  };

  const handleEnd = async () => {
    if (!status?.isLoaded || pendingStart == null) return;
    const endSec = status.positionMillis / 1000;
    if (endSec <= pendingStart) {
      Alert.alert('範囲エラー', '終了時刻が開始時刻より前になっています');
      return;
    }
    await addEvent(videoId, {
      tagTypes: [currentTag],
      startSec: pendingStart,
      endSec,
      note: '',
      createdBy: 'anon',
    });
    setPendingStart(null);
  };

  const goHighlights = () => {
    navigation.navigate('Highlights', { videoId });
  };

  const renderTag = ({ item }) => {
    const active = item === currentTag;
    return (
      <TouchableOpacity
        onPress={() => setCurrentTag(item)}
        style={[styles.tagBtn, active && styles.tagBtnActive]}
      >
        <Text style={[styles.tagBtnText, active && styles.tagBtnTextActive]}>{item}</Text>
      </TouchableOpacity>
    );
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
            onPlaybackStatusUpdate={setStatus}
          />
          <View style={styles.row}>
            <FlatList
              data={TAG_PRESETS}
              horizontal
              keyExtractor={(t) => t}
              renderItem={renderTag}
              contentContainerStyle={{ paddingHorizontal: 8 }}
              showsHorizontalScrollIndicator={false}
            />
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleStart}>
              <Text style={styles.actionBtnText}>開始（{currentTag}）</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.endBtn]} onPress={handleEnd}>
              <Text style={styles.actionBtnText}>終了</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={goHighlights}>
              <Text style={styles.secondaryBtnText}>▶ ハイライト再生へ</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={events}
            keyExtractor={(e) => e.id}
            renderItem={({ item, index }) => (
              <View style={styles.eventItem}>
                <Text style={styles.eventText}>
                  #{index + 1} [{item.startSec.toFixed(1)}s - {item.endSec.toFixed(1)}s] {item.tagTypes?.join(', ')}
                </Text>
              </View>
            )}
            ListHeaderComponent={<Text style={{ fontWeight: 'bold', marginBottom: 4 }}>記録済みイベント</Text>}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF' },
  video: { width: '100%', height: 220, backgroundColor: '#000' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  tagBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 4 },
  tagBtnActive: { backgroundColor: '#0077cc' },
  tagBtnText: { color: '#0077cc', fontWeight: 'bold' },
  tagBtnTextActive: { color: '#fff' },
  actionBtn: { flex: 1, marginHorizontal: 8, backgroundColor: '#0077cc', borderRadius: 8, alignItems: 'center', padding: 12 },
  endBtn: { backgroundColor: '#cc3300' },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },
  secondaryBtn: { flex: 1, marginHorizontal: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', borderRadius: 8, alignItems: 'center', padding: 12 },
  secondaryBtnText: { color: '#0077cc', fontWeight: 'bold' },
  eventItem: { backgroundColor: '#fff', padding: 8, borderRadius: 6, marginVertical: 4 },
  eventText: { color: '#333' },
});
