import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, TextInput } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import YoutubePlayer from 'react-native-youtube-iframe';
import { getVideo, subscribeEvents, addEvent } from '../services/firestoreService';

function parseYouTubeId(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => ['shorts', 'embed', 'live'].includes(p));
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch {}
  return null;
}

function splitTags(text) {
  return String(text || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function TaggingScreen({ route, navigation }) {
  const { videoId } = route.params;
  const [video, setVideo] = useState(null);
  const [events, setEvents] = useState([]);
  const [tagText, setTagText] = useState('');
  const [pendingStart, setPendingStart] = useState(null);
  const videoRef = useRef(null);
  const [status, setStatus] = useState(null);
  const ytRef = useRef(null);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [previewEndSec, setPreviewEndSec] = useState(null);

  const isYoutube = video?.sourceType === 'youtube';
  const youtubeId = useMemo(() => {
    return video?.youtubeId || parseYouTubeId(video?.videoUrl);
  }, [video]);

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

  // expo-av: クリップ再生時、終端を超えたら停止
  const handlePlaybackStatusUpdate = (s) => {
    setStatus(s);
    if (!s?.isLoaded || !s?.isPlaying) return;
    if (previewEndSec == null) return;
    const posSec = s.positionMillis / 1000;
    if (posSec >= previewEndSec) {
      videoRef.current?.setStatusAsync({ shouldPlay: false });
      setPreviewEndSec(null);
    }
  };

  // YouTube: クリップ再生時、終端を超えたら停止（interval）
  useEffect(() => {
    if (!isYoutube) return;
    const timer = setInterval(async () => {
      if (!ytPlaying) return;
      if (previewEndSec == null) return;
      try {
        const t = await ytRef.current?.getCurrentTime?.();
        if (typeof t === 'number' && t >= previewEndSec) {
          setYtPlaying(false);
          setPreviewEndSec(null);
        }
      } catch {}
    }, 200);
    return () => clearInterval(timer);
  }, [isYoutube, ytPlaying, previewEndSec]);

  const getCurrentSec = async () => {
    if (isYoutube) {
      try {
        const t = await ytRef.current?.getCurrentTime?.();
        return typeof t === 'number' ? t : null;
      } catch {
        return null;
      }
    }
    if (!status?.isLoaded) return null;
    return status.positionMillis / 1000;
  };

  const handleTagStart = async () => {
    const t = await getCurrentSec();
    if (t == null) return;
    setPendingStart(t);
  };

  const handleTagEnd = async () => {
    const endSec = await getCurrentSec();
    if (endSec == null || pendingStart == null) return;

    if (endSec <= pendingStart) {
      Alert.alert('範囲エラー', '終了時刻が開始時刻より前になっています');
      return;
    }

    const tags = splitTags(tagText);
    if (!tags.length) {
      Alert.alert('タグ未入力', 'タグを入力してください（例：シュート,10番）');
      return;
    }

    await addEvent(videoId, {
      tagTypes: tags,
      startSec: pendingStart,
      endSec,
      note: '',
      createdBy: 'anon',
    });

    setPendingStart(null);
    setTagText('');
  };

  const goHighlights = () => {
    navigation.navigate('Highlights', { videoId });
  };

  const playFullFromStart = async () => {
    setPreviewEndSec(null);
    if (isYoutube) {
      if (!youtubeId) {
        Alert.alert('エラー', 'YouTube動画IDが取得できませんでした');
        return;
      }
      ytRef.current?.seekTo?.(0, true);
      setYtPlaying(true);
      return;
    }
    await videoRef.current?.setStatusAsync({ positionMillis: 0, shouldPlay: true });
  };

  const playClip = async (startSec, endSec) => {
    setPreviewEndSec(endSec);
    if (isYoutube) {
      if (!youtubeId) {
        Alert.alert('エラー', 'YouTube動画IDが取得できませんでした');
        return;
      }
      ytRef.current?.seekTo?.(Math.max(startSec, 0), true);
      setYtPlaying(true);
      return;
    }
    await videoRef.current?.setStatusAsync({
      positionMillis: Math.max(startSec, 0) * 1000,
      shouldPlay: true,
    });
  };

  return (
    <View style={styles.container}>
      {video && (
        <>
          {isYoutube ? (
            <View style={styles.videoWrap}>
              <YoutubePlayer
                ref={ytRef}
                height={220}
                videoId={youtubeId || ''}
                play={ytPlaying}
                onChangeState={(s) => {
                  if (s === 'ended') setYtPlaying(false);
                }}
              />
            </View>
          ) : (
            <Video
              ref={videoRef}
              source={{ uri: video.videoUrl }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
            />
          )}

          <View style={styles.tagArea}>
            <Text style={styles.label}>タグ（カンマ区切りOK）</Text>
            <TextInput
              style={styles.input}
              value={tagText}
              onChangeText={setTagText}
              placeholder="例）シュート,10番 / パスミス / GK"
            />
            <Text style={styles.small}>
              {pendingStart == null ? '開始未記録' : `開始記録: ${pendingStart.toFixed(2)}s`}
            </Text>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleTagStart}>
              <Text style={styles.actionBtnText}>タグ開始</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.endBtn]} onPress={handleTagEnd}>
              <Text style={styles.actionBtnText}>タグ終了</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={playFullFromStart}>
              <Text style={styles.secondaryBtnText}>▶ 最初から再生</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={goHighlights}>
              <Text style={styles.secondaryBtnText}>▶ ハイライト再生へ</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={events}
            keyExtractor={(e) => e.id}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={styles.eventItem}
                onPress={() => playClip(item.startSec, item.endSec)}
              >
                <Text style={styles.eventText}>
                  #{index + 1} [{item.startSec.toFixed(1)}s - {item.endSec.toFixed(1)}s] {item.tagTypes?.join(', ')}
                </Text>
              </TouchableOpacity>
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
  videoWrap: { width: '100%', height: 220, backgroundColor: '#000' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8 },
  tagArea: { paddingHorizontal: 12, paddingTop: 10 },
  label: { fontWeight: 'bold' },
  input: { backgroundColor: '#fff', padding: 10, borderRadius: 8, marginTop: 6 },
  small: { marginTop: 6, color: '#333' },
  actionBtn: { flex: 1, marginHorizontal: 8, backgroundColor: '#0077cc', borderRadius: 8, alignItems: 'center', padding: 12 },
  endBtn: { backgroundColor: '#cc3300' },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },
  secondaryBtn: { flex: 1, marginHorizontal: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', borderRadius: 8, alignItems: 'center', padding: 12 },
  secondaryBtnText: { color: '#0077cc', fontWeight: 'bold' },
  eventItem: { backgroundColor: '#fff', padding: 8, borderRadius: 6, marginVertical: 4 },
  eventText: { color: '#333' },
});
