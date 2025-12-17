import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import YoutubePlayer from 'react-native-youtube-iframe';
import { getVideo, subscribeEvents, subscribeTags } from '../services/firestoreService';
import { PLAYBACK_MARGIN_START, PLAYBACK_MARGIN_END } from '../constants';

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

export default function HighlightPlayerScreen({ route, navigation }) {
  const { videoId } = route.params;
  const ytRef = useRef(null);
  const [video, setVideo] = useState(null);
  const [events, setEvents] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [matchMode, setMatchMode] = useState('OR'); // 'OR' | 'AND'
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  const [ytPlaying, setYtPlaying] = useState(false);

  // URL(MP4/HLS) 再生用（expo-video）
  const urlPlayer = useVideoPlayer(null);
  const { isUrlPlaying } = useEvent(urlPlayer, 'playingChange', { isUrlPlaying: urlPlayer.playing });
  
  const isYoutube = video?.sourceType === 'youtube';
  const youtubeId = useMemo(() => {
    return video?.youtubeId || parseYouTubeId(video?.videoUrl);
  }, [video]);

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

  useEffect(() => {
    const unsub = subscribeTags(videoId, setTags);
    return () => unsub?.();
  }, [videoId]);
  // URL(MP4/HLS) のときだけ player にソース反映（null player -> replace() が公式推奨）:contentReference[oaicite:2]{index=2}
  useEffect(() => {
    if (!video) return;
    if (video.sourceType === 'youtube') {
      try { urlPlayer.pause(); } catch {}
      return;
    }
    const url = (video.videoUrl || '').trim();
    if (!url) return;
    try { urlPlayer.replace(url); } catch {}
  }, [video]);

  // tagsが更新されたら、selectedTagsを存在するタグだけに整理
  useEffect(() => {
    const exist = new Set(tags.map(t => t?.name).filter(Boolean));
    setSelectedTags(prev => {
      const next = new Set();
      prev.forEach(n => { if (exist.has(n)) next.add(n); });
      return next;
    });
  }, [tags]);

  const selectedTagArray = useMemo(() => Array.from(selectedTags), [selectedTags]);

  const playlist = useMemo(() => {
    if (!selectedTagArray.length) return [];
    const ok = events.filter(e => {
      const t = Array.isArray(e.tagTypes) ? e.tagTypes : [];
      if (matchMode === 'AND') return selectedTagArray.every(x => t.includes(x));
      return selectedTagArray.some(x => t.includes(x)); // OR（デフォルト）
    });
    return ok.slice().sort((a, b) => a.startSec - b.startSec);
  }, [events, selectedTagArray, matchMode]);

  useEffect(() => {
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    // 条件が変わって空になったら停止
    if (playlist.length === 0) {
      setYtPlaying(false);
      try { urlPlayer.pause(); } catch {}
    }
  }, [playlist]);

  useEffect(() => {
    // クリップ変わったらシーク
    const clip = playlist[currentIndex];
    if (!clip) return;

    currentIndexRef.current = currentIndex;

    const startPos = Math.max(clip.startSec - PLAYBACK_MARGIN_START, 0);

    if (isYoutube) {
      if (!youtubeId) return;
      ytRef.current?.seekTo?.(startPos, true);
      setYtPlaying(true);
      return;
    }

    try {
      urlPlayer.currentTime = startPos;
      urlPlayer.play();
    } catch {}

  }, [currentIndex, playlist, isYoutube, youtubeId]);

  // 終端判定して次へ（YouTube / URL 共通）
  useEffect(() => {
    const timer = setInterval(async () => {
      const idx = currentIndexRef.current;
      const clip = playlist[idx];
      if (!clip) return;

      const endLimit = Math.max(clip.endSec - PLAYBACK_MARGIN_END, clip.startSec);

      if (isYoutube) {
        if (!ytPlaying) return;
        try {
          const t = await ytRef.current?.getCurrentTime?.();
          if (typeof t !== 'number') return;
          if (t >= endLimit) {
            const nextIndex = idx + 1;
            const nextClip = playlist[nextIndex];
            if (nextClip) {
              currentIndexRef.current = nextIndex;
              setCurrentIndex(nextIndex);
            } else {
              setYtPlaying(false);
            }
          }
        } catch {}
      } else {
        if (!isUrlPlaying) return;
        try {
          const t = urlPlayer?.currentTime ?? 0;
          if (t >= endLimit) {
            const nextIndex = idx + 1;
            const nextClip = playlist[nextIndex];
            if (nextClip) {
              currentIndexRef.current = nextIndex;
              setCurrentIndex(nextIndex);
            } else {
              urlPlayer.pause();
            }
          }
        } catch {}
      }
    }, 200);
    return () => clearInterval(timer);
  }, [isYoutube, ytPlaying, playlist, isUrlPlaying]);

  const playFrom = (index) => {
    if (!playlist[index]) return;
    currentIndexRef.current = index;
    setCurrentIndex(index);
  };

  const toggleSelectTag = (name) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
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
            <VideoView
              player={urlPlayer}
              style={styles.video}
              contentFit="contain"
              nativeControls
              allowsFullscreen
              allowsPictureInPicture
            />
          )}

          <View style={styles.filterRow}>
            <View style={styles.filterHeader}>
              <Text style={styles.label}>タグで絞り込み（{matchMode}）</Text>
              <TouchableOpacity
                style={styles.modeBtn}
                onPress={() => setMatchMode(m => (m === 'OR' ? 'AND' : 'OR'))}
              >
                <Text style={styles.modeBtnText}>切替</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => setSelectedTags(new Set())}
              >
                <Text style={styles.clearBtnText}>クリア</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.tagButtonsWrap}>
              {tags.length === 0 ? (
                <Text style={styles.small}>タグがありません（タグ付け画面で登録してください）</Text>
              ) : (
                tags.map(t => {
                  const name = t?.name;
                  if (!name) return null;
                  const on = selectedTags.has(name);
                  return (
                    <TouchableOpacity
                      key={t.id || name}
                      style={[styles.tagBtn, on ? styles.tagBtnActive : styles.tagBtnInactive]}
                      onPress={() => toggleSelectTag(name)}
                    >
                      <Text style={[styles.tagBtnText, on ? styles.tagBtnTextActive : styles.tagBtnTextInactive]}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

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
            ListEmptyComponent={<Text style={{ padding: 8 }}>タグを選択してください（または条件に一致するクリップがありません）</Text>}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF' },
  videoWrap: { width: '100%', height: 220, backgroundColor: '#000' },
  video: { width: '100%', height: 220, backgroundColor: '#000' },
  filterRow: { padding: 12 },
  label: { fontWeight: 'bold' },
  small: { marginTop: 6, color: '#333' },
  filterHeader: { flexDirection: 'row', alignItems: 'center' },
  modeBtn: { marginLeft: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  modeBtnText: { color: '#0077cc', fontWeight: 'bold' },
  clearBtn: { marginLeft: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#999', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  clearBtnText: { color: '#333', fontWeight: 'bold' },
  tagButtonsWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  tagBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, marginRight: 8, marginBottom: 8 },
  tagBtnActive: { backgroundColor: '#0077cc', borderColor: '#0077cc' },
  tagBtnInactive: { backgroundColor: '#fff', borderColor: '#0077cc' },
  tagBtnText: { fontWeight: 'bold' },
  tagBtnTextActive: { color: '#fff' },
  tagBtnTextInactive: { color: '#0077cc' },  
  clipItem: { backgroundColor: '#fff', padding: 10, borderRadius: 6, marginVertical: 4 },
  clipItemActive: { borderWidth: 2, borderColor: '#0077cc' },
  clipText: { color: '#333' },
});
