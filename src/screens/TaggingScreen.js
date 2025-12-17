import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, TextInput } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import YoutubePlayer from 'react-native-youtube-iframe';
import {
  getVideo,
  subscribeEvents,
  addEvent,
  subscribeTags,
  upsertTag,
  deleteTag,
  removeTagFromAllEvents,
} from '../services/firestoreService';

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
  // タグ登録用
  const [tagText, setTagText] = useState('');
  // タグ一覧（Firestore）
  const [tags, setTags] = useState([]);
  // アクティブタグ
  const [activeTags, setActiveTags] = useState(new Set());

  // 記録中（開始秒＋開始時点のタグスナップショット）
  const [pendingStart, setPendingStart] = useState(null);
  const [pendingTagTypes, setPendingTagTypes] = useState(null);
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

  useEffect(() => {
    const unsub = subscribeTags(videoId, setTags);
    return () => unsub?.();
  }, [videoId]);

  // tagsが更新されたら、activeTagsを存在するタグだけに整理
  useEffect(() => {
    const exist = new Set(tags.map(t => t?.name).filter(Boolean));
    setActiveTags(prev => {
      const next = new Set();
      prev.forEach(n => { if (exist.has(n)) next.add(n); });
      return next;
    });
  }, [tags]);

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

  const handleRegisterTags = async () => {
    const names = splitTags(tagText);
    if (!names.length) {
      Alert.alert('タグ未入力', 'タグを入力してください（例：シュート,10番）');
      return;
    }
    try {
      await Promise.all(names.map(n => upsertTag(videoId, n)));
      setTagText('');
    } catch (e) {
      Alert.alert('エラー', 'タグ登録に失敗しました');
    }
  };

  const toggleTag = (name) => {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const confirmDeleteTag = (name) => {
    Alert.alert('タグ削除', `「${name}」を削除しますか？\n※既存の記録からも削除されます`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTag(videoId, name);
            await removeTagFromAllEvents(videoId, name);

            // 記録中のスナップショットにも反映（空になったら記録を解除）
            setPendingTagTypes(prev => {
              if (!Array.isArray(prev)) return prev;
              const next = prev.filter(t => t !== name);
              if (next.length === 0) {
                setPendingStart(null);
                return null;
              }
              return next;
            });

            // アクティブ解除
            setActiveTags(prev => {
              const next = new Set(prev);
              next.delete(name);
              return next;
            });
          } catch (e) {
            Alert.alert('エラー', 'タグ削除に失敗しました');
          }
        }
      }
    ]);
  };

  const handleRecordStart = async () => {
    if (pendingStart != null) {
      Alert.alert('記録中', 'すでに記録開始されています。先に「記録終了」してください。');
      return;
    }
    const selected = Array.from(activeTags);
    if (!selected.length) {
      Alert.alert('タグ未選択', '記録するタグを1つ以上アクティブにしてください。');
      return;
    }
    const t = await getCurrentSec();
    if (t == null) return;
    setPendingStart(t);
    setPendingTagTypes(selected);
  };

  const handleRecordEnd = async () => {
    const endSec = await getCurrentSec();
    if (endSec == null || pendingStart == null) return;

    if (endSec <= pendingStart) {
      Alert.alert('範囲エラー', '終了時刻が開始時刻より前になっています');
      return;
    }

    const tagsForThisRecord = Array.isArray(pendingTagTypes) ? pendingTagTypes : [];
    if (!tagsForThisRecord.length) {
      Alert.alert('タグ未選択', '記録開始時点のタグがありません。もう一度「記録開始」から行ってください。');
      setPendingStart(null);
      setPendingTagTypes(null);
      return;
    }

    await addEvent(videoId, {
      tagTypes: tagsForThisRecord,
      startSec: pendingStart,
      endSec,
      note: '',
      createdBy: 'anon',
    });

    setPendingStart(null);
    setPendingTagTypes(null);
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
            <Text style={styles.label}>タグ登録（カンマ区切りOK）</Text>
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

            <Text style={[styles.label, { marginTop: 10 }]}>タグボタン（押してON/OFF・長押しで削除）</Text>
            <View style={styles.tagButtonsWrap}>
              {tags.length === 0 ? (
                <Text style={styles.small}>まだタグが登録されていません</Text>
              ) : (
                tags.map((t) => {
                  const name = t?.name;
                  if (!name) return null;
                  const isActive = activeTags.has(name);
                  return (
                    <TouchableOpacity
                      key={t.id || name}
                      style={[styles.tagBtn, isActive ? styles.tagBtnActive : styles.tagBtnInactive]}
                      onPress={() => toggleTag(name)}
                      onLongPress={() => confirmDeleteTag(name)}
                    >
                      <Text style={[styles.tagBtnText, isActive ? styles.tagBtnTextActive : styles.tagBtnTextInactive]}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            <Text style={styles.small}>
              {pendingStart == null
                ? '開始未記録'
                : `開始記録: ${pendingStart.toFixed(2)}s / タグ: ${(pendingTagTypes || []).join(', ')}`}
            </Text>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleRecordStart}>
              <Text style={styles.actionBtnText}>記録開始</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.endBtn]} onPress={handleRecordEnd}>
              <Text style={styles.actionBtnText}>記録終了</Text>
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
  tagRegisterRow: { flexDirection: 'row', alignItems: 'center' },
  confirmBtn: { marginTop: 6, marginLeft: 8, backgroundColor: '#0077cc', borderRadius: 8, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  confirmBtnText: { color: '#fff', fontWeight: 'bold' },
  tagButtonsWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  tagBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, marginRight: 8, marginBottom: 8 },
  tagBtnActive: { backgroundColor: '#0077cc', borderColor: '#0077cc' },
  tagBtnInactive: { backgroundColor: '#fff', borderColor: '#0077cc' },
  tagBtnText: { fontWeight: 'bold' },
  tagBtnTextActive: { color: '#fff' },
  tagBtnTextInactive: { color: '#0077cc' },
  actionBtn: { flex: 1, marginHorizontal: 8, backgroundColor: '#0077cc', borderRadius: 8, alignItems: 'center', padding: 12 },
  endBtn: { backgroundColor: '#cc3300' },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },
  secondaryBtn: { flex: 1, marginHorizontal: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', borderRadius: 8, alignItems: 'center', padding: 12 },
  secondaryBtnText: { color: '#0077cc', fontWeight: 'bold' },
  eventItem: { backgroundColor: '#fff', padding: 8, borderRadius: 6, marginVertical: 4 },
  eventText: { color: '#333' },
});
