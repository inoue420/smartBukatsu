//HighlightPlayerScreen.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, StatusBar, useWindowDimensions } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import YoutubePlayer from 'react-native-youtube-iframe';
import * as ScreenOrientation from 'expo-screen-orientation';
import { getVideo, subscribeEvents, subscribeTags } from '../services/firestoreService';
import { PLAYBACK_MARGIN_START, PLAYBACK_MARGIN_END } from '../constants';
import { useAuth } from '../contexts/AuthContext';

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
  const { activeTeamId } = useAuth();
  const { width, height } = useWindowDimensions();
  const ytRef = useRef(null);
  const ytStateRef = useRef('unstarted');
  const remountedAfterFinishRef = useRef(false);
  const finishedRef = useRef(false); // 最後まで到達して停止したか（再開しちゃう個体差対策）
  const finishAtRef = useRef(null);  // 最終停止させたい時刻（秒）
  const [finished, setFinished] = useState(false); // finished を state でも持ってタイマーを止める
  const [video, setVideo] = useState(null);
  const [events, setEvents] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [matchMode, setMatchMode] = useState('OR'); // 'OR' | 'AND'
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [landscapeMode, setLandscapeMode] = useState(false);
  const [playerKey, setPlayerKey] = useState(0); // YouTube強制停止用（再マウント）

  const { fsVideoW } = useMemo(() => {
    const uiMin = 280; // 右側はタグ＋一覧があるので少し広めに確保
    const ideal = Math.round((height * 16) / 9);
    let vw = ideal;
    if (width - vw < uiMin) vw = width - uiMin;
    vw = Math.max(240, Math.min(vw, Math.floor(width * 0.8)));
    return { fsVideoW: vw };
  }, [width, height]);

  // URL(MP4/HLS) 再生用（expo-video）
  const urlPlayer = useVideoPlayer(null);
  const { isUrlPlaying } = useEvent(urlPlayer, 'playingChange', { isUrlPlaying: urlPlayer.playing });
  
  const isYoutube = video?.sourceType === 'youtube';
  const youtubeId = useMemo(() => {
    return video?.youtubeId || parseYouTubeId(video?.videoUrl);
  }, [video]);

  useEffect(() => {
    (async () => {
      if (!activeTeamId) return;
      const v = await getVideo(activeTeamId, videoId);
      if (!v) {
        Alert.alert('エラー', '動画が見つかりません');
        navigation.goBack();
        return;
      }
      setVideo(v);
      navigation.setOptions({ title: `ハイライト：${v.title}` });
    })();
  }, [activeTeamId, videoId]);

  useEffect(() => {
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);
  
  useEffect(() => {
    if (!activeTeamId) return;
    const unsub = subscribeEvents(activeTeamId, videoId, setEvents);
    return () => unsub();
  }, [activeTeamId, videoId]);

  useEffect(() => {
    if (!activeTeamId) return;
    const unsub = subscribeTags(activeTeamId, setTags);
    return () => unsub?.();
  }, [activeTeamId]);
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
    finishedRef.current = false;
    finishAtRef.current = null;
    setFinished(false);
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

    finishedRef.current = false;
    finishAtRef.current = null;
    setFinished(false);
    remountedAfterFinishRef.current = false;
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
    // finished ならこのタイマー自体を回さない（読み込み連打の原因を断つ）
    if (finished) return;
    const timer = setInterval(async () => {
      const idx = currentIndexRef.current;
      const clip = playlist[idx];
      if (!clip) return;

      const isLast = !playlist[idx + 1];
      // 最後のクリップは endSec で止める（マージンは引かない）
      const endLimit = isLast
        ? clip.endSec
        : Math.max(clip.endSec - PLAYBACK_MARGIN_END, clip.startSec);

      if (isYoutube) {
        // ズレてる時だけ seek（毎回 seek すると「読み込み」に見えやすい）
        (async () => {
          if (typeof fin === 'number') {
            try {
              const cur = await ytRef.current?.getCurrentTime?.();
              if (typeof cur === 'number' && Math.abs(cur - fin) > 0.6) {
                try { ytRef.current?.seekTo?.(fin, true); } catch {}
              }
            } catch {}
          }
        })();
        try {
          const t = await ytRef.current?.getCurrentTime?.();
          if (typeof t !== 'number') return;
          if (t >= endLimit) {
            if (!isLast) {
              const nextIndex = idx + 1;
              currentIndexRef.current = nextIndex;
              setCurrentIndex(nextIndex);
            } else {
              finishedRef.current = true;
              finishAtRef.current = endLimit;
              // まずは素直に止める（seekはしない：seekが再生復帰/バッファの原因になりやすい）
              try { ytRef.current?.pauseVideo?.(); } catch {}
              setYtPlaying(false);
              setFinished(true);
            }
          }
        } catch {}
      } else {
        if (!isUrlPlaying) return;
        try {
          const t = urlPlayer?.currentTime ?? 0;
          if (t >= endLimit) {
            if (!isLast) {
              const nextIndex = idx + 1;
              currentIndexRef.current = nextIndex;
              setCurrentIndex(nextIndex);
            } else {
              finishedRef.current = true;
              finishAtRef.current = endLimit;
              try { urlPlayer.currentTime = endLimit; } catch {}
              urlPlayer.pause();
              setFinished(true);
            }
          }
        } catch {}
      }
    }, 200);
    return () => clearInterval(timer);
  }, [isYoutube, ytPlaying, playlist, isUrlPlaying, finished]);

  // finished になった瞬間に “もう一回だけ” 停止を押し込む（端末差対策）
  useEffect(() => {
    if (!finished) return;
    const fin = finishAtRef.current;
    const id = setTimeout(() => {
      if (isYoutube) {
        try { ytRef.current?.pauseVideo?.(); } catch {}
        setYtPlaying(false);

        // それでも “再生が復帰する端末” 用：まだ動いていたら1回だけ再マウントして止める
        setTimeout(async () => {
          if (remountedAfterFinishRef.current) return;
          try {
            const cur = await ytRef.current?.getCurrentTime?.();
            // fin が取れていて、かつ fin より明らかに進んでるならまだ再生中
            if (typeof fin === 'number' && typeof cur === 'number' && cur > fin + 0.8) {
              remountedAfterFinishRef.current = true;
              setPlayerKey(k => k + 1);
            }
          } catch {
            // ref が不安定な端末もあるので、その場合も1回だけ再マウント
            remountedAfterFinishRef.current = true;
            setPlayerKey(k => k + 1);
          }
        }, 600);
      } else {
        if (typeof fin === 'number') { try { urlPlayer.currentTime = fin; } catch {} }
        try { urlPlayer.pause(); } catch {}
      }
    }, 350);
    return () => clearTimeout(id);
  }, [finished, isYoutube]);  
  const playFrom = (index) => {
    if (!playlist[index]) return;
    finishedRef.current = false;
    finishAtRef.current = null;
    setFinished(false);
    remountedAfterFinishRef.current = false;
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

  const openLandscapeMode = async () => {
    if (landscapeMode) return;
    try {
      setLandscapeMode(true);
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch {}
  };

  const closeLandscapeMode = async () => {
    setYtPlaying(false);
    try { urlPlayer.pause(); } catch {}
    setLandscapeMode(false);
    try { await ScreenOrientation.unlockAsync(); } catch {}
  };

  const renderPlayer = ({ landscape = false } = {}) => {
    if (isYoutube) {
      return (
        <View style={landscape ? [styles.fsVideoWrap, { width: fsVideoW }] : styles.videoWrap}>
          <YoutubePlayer
            key={`${youtubeId || 'yt'}-${playerKey}`}
            ref={ytRef}
            height={landscape ? Math.max(200, height) : 220}
            width={landscape ? fsVideoW : undefined}
            videoId={youtubeId || ''}
            play={ytPlaying && !finished}
            initialPlayerParams={landscape ? { preventFullScreen: true } : undefined}
            onChangeState={(s) => {
               ytStateRef.current = s;
              // finished なのに再度 playing になる個体差対策（より強く）
              // ※ state名は 'cued'（'video cued' ではない）
              if (finishedRef.current && (s === 'playing' || s === 'buffering')) {
                // ここでも “1回だけ” 再マウントで叩き潰す
                if (!remountedAfterFinishRef.current) {
                  remountedAfterFinishRef.current = true;
                  setPlayerKey(k => k + 1);
                }
                try { ytRef.current?.pauseVideo?.(); } catch {}
                setYtPlaying(false);
                return;
              }
              if (s === 'ended') setYtPlaying(false);
            }}
          />
        </View>
      );
    }
    return (
      <VideoView
        player={urlPlayer}
        style={landscape ? [styles.fsVideo, { width: fsVideoW }] : styles.video}
        contentFit="contain"
        nativeControls
        fullscreenOptions={{ enabled: !landscape }}
        allowsPictureInPicture
      />
    );
  };

  return (
    <View style={styles.container}>
      {video && (
        <>
          <StatusBar hidden={landscapeMode} />

          {landscapeMode ? (
            <View style={styles.fsRoot}>
              <View style={styles.fsRow}>
                <View style={[styles.fsVideoCol, { width: fsVideoW }]}>
                  {renderPlayer({ landscape: true })}
                </View>

                <View style={styles.fsUiCol}>
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
                    ListHeaderComponent={
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
                        <Text style={[styles.label, { marginTop: 8 }]}>クリップ一覧</Text>
                      </View>
                    }
                    contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
                    ListEmptyComponent={<Text style={{ padding: 8 }}>タグを選択してください（または条件に一致するクリップがありません）</Text>}
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.fsCloseBtn} onPress={closeLandscapeMode}>
                <Text style={styles.fsCloseBtnText}>閉じる</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {renderPlayer({ landscape: false })}

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
                  <TouchableOpacity
                    style={styles.landscapeBtn}
                    onPress={openLandscapeMode}
                  >
                    <Text style={styles.landscapeBtnText}>横</Text>
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
  landscapeBtn: { marginLeft: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  landscapeBtnText: { color: '#0077cc', fontWeight: 'bold' },
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

  // 横画面（疑似フルスクリーン）
  fsRoot: { flex: 1, backgroundColor: '#000' },
  fsRow: { flex: 1, flexDirection: 'row' },
  fsVideoCol: { backgroundColor: '#000' },
  fsUiCol: { flex: 1, backgroundColor: '#E0FFFF' },
  fsVideo: { height: '100%', backgroundColor: '#000' },
  fsVideoWrap: { height: '100%', backgroundColor: '#000' },
  fsCloseBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  fsCloseBtnText: { color: '#fff', fontWeight: 'bold' },  
});
