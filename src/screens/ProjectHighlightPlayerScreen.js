import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, StatusBar } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import YoutubePlayer from 'react-native-youtube-iframe';

import { useAuth } from '../contexts/AuthContext';
import { getProject, subscribeProjectVideos, getVideo, listEventsOnce, subscribeTags } from '../services/firestoreService';
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

export default function ProjectHighlightPlayerScreen({ route, navigation }) {
  const { projectId } = route.params;
  const { activeTeamId } = useAuth();

  const ytRef = useRef(null);
  const currentIndexRef = useRef(0);
  const finishedRef = useRef(false);

  const [project, setProject] = useState(null);
  const [projectVideos, setProjectVideos] = useState([]); // [{id(videoId), order, offsetSec}]
  const [videosById, setVideosById] = useState({}); // videoId -> videoDoc
  const [allClips, setAllClips] = useState([]); // aggregated clips

  const [tags, setTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [matchMode, setMatchMode] = useState('OR');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [finished, setFinished] = useState(false);

  // URL(MP4/HLS) 再生用
  const urlPlayer = useVideoPlayer(null);
  const { isUrlPlaying } = useEvent(urlPlayer, 'playingChange', { isUrlPlaying: urlPlayer.playing });

  // project / projectVideos
  useEffect(() => {
    (async () => {
      if (!activeTeamId) return;
      const p = await getProject(activeTeamId, projectId);
      if (!p) {
        Alert.alert('エラー', 'プロジェクトが見つかりません');
        navigation.goBack();
        return;
      }
      setProject(p);
      navigation.setOptions({ title: `PJ：${p.name}` });
    })();
  }, [activeTeamId, projectId]);

  useEffect(() => {
    if (!activeTeamId) return;
    const unsub = subscribeProjectVideos(activeTeamId, projectId, setProjectVideos);
    return () => unsub?.();
  }, [activeTeamId, projectId]);

  // tags
  useEffect(() => {
    if (!activeTeamId) return;
    const unsub = subscribeTags(activeTeamId, setTags);
    return () => unsub?.();
  }, [activeTeamId]);

  // 集約ロード（projectVideos 変更時に再構築：まずは getDocs ベースの “軽い集約”）
  useEffect(() => {
    let canceled = false;

    (async () => {
      if (!activeTeamId) return;
      if (!projectVideos.length) {
        setVideosById({});
        setAllClips([]);
        return;
      }

      try {
        const pvSorted = projectVideos.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const videoPairs = await Promise.all(
          pvSorted.map(async (pv) => {
            const v = await getVideo(activeTeamId, pv.id);
            const evs = await listEventsOnce(activeTeamId, pv.id);
            return { pv, v, evs };
          })
        );

        if (canceled) return;

        const nextVideosById = {};
        const nextClips = [];

        for (const pair of videoPairs) {
          const videoId = pair.pv.id;
          const v = pair.v;
          if (v) nextVideosById[videoId] = v;

          const order = typeof pair.pv.order === 'number' ? pair.pv.order : 0;
          const offsetSec = typeof pair.pv.offsetSec === 'number' ? pair.pv.offsetSec : 0;

          (pair.evs || []).forEach((e) => {
            const tagTypes = Array.isArray(e.tagTypes) ? e.tagTypes : [];
            const startSec = Number(e.startSec ?? 0);
            const endSec = Number(e.endSec ?? 0);
            // offsetSec が未運用でも “order順→startSec” で並ぶように sortKey を作る
            const sortKey = offsetSec + startSec + order * 1000000;

            nextClips.push({
              uid: `${videoId}_${e.id}`,
              videoId,
              eventId: e.id,
              startSec,
              endSec,
              tagTypes,
              sortKey,
              title: v?.title || '',
            });
          });
        }

        nextClips.sort((a, b) => a.sortKey - b.sortKey);

        setVideosById(nextVideosById);
        setAllClips(nextClips);
      } catch (e) {
        console.error(e);
        Alert.alert('エラー', 'プロジェクトの集約に失敗しました');
      }
    })();

    return () => {
      canceled = true;
    };
  }, [activeTeamId, projectVideos]);

  // tags が更新されたら selectedTags を整理
  useEffect(() => {
    const exist = new Set(tags.map((t) => t?.name).filter(Boolean));
    setSelectedTags((prev) => {
      const next = new Set();
      prev.forEach((n) => {
        if (exist.has(n)) next.add(n);
      });
      return next;
    });
  }, [tags]);

  const selectedTagArray = useMemo(() => Array.from(selectedTags), [selectedTags]);

  const playlist = useMemo(() => {
    if (!selectedTagArray.length) return [];
    const ok = allClips.filter((c) => {
      const t = Array.isArray(c.tagTypes) ? c.tagTypes : [];
      if (matchMode === 'AND') return selectedTagArray.every((x) => t.includes(x));
      return selectedTagArray.some((x) => t.includes(x));
    });
    return ok.slice().sort((a, b) => a.sortKey - b.sortKey);
  }, [allClips, selectedTagArray, matchMode]);

  // 条件変更で先頭へ
  useEffect(() => {
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    finishedRef.current = false;
    setFinished(false);
    setYtPlaying(false);
    try { urlPlayer.pause(); } catch {}
  }, [playlist.length, matchMode, selectedTagArray.join('|')]);

  const currentClip = playlist[currentIndex] || null;
  const currentVideo = currentClip ? videosById[currentClip.videoId] : null;

  const isYoutube = currentVideo?.sourceType === 'youtube';
  const youtubeId = useMemo(() => {
    if (!currentVideo) return null;
    return currentVideo.youtubeId || parseYouTubeId(currentVideo.videoUrl);
  }, [currentVideo]);

  // 動画切替時：URLなら replace、YouTubeならURL停止
  useEffect(() => {
    if (!currentVideo) return;
    if (currentVideo.sourceType === 'youtube') {
      try { urlPlayer.pause(); } catch {}
      return;
    }
    const url = (currentVideo.videoUrl || '').trim();
    if (!url) return;
    try { urlPlayer.replace(url); } catch {}
  }, [currentVideo]);

  // クリップ開始シーク
  useEffect(() => {
    if (!currentClip || !currentVideo) return;

    finishedRef.current = false;
    setFinished(false);
    currentIndexRef.current = currentIndex;

    const startPos = Math.max(currentClip.startSec - PLAYBACK_MARGIN_START, 0);

    if (isYoutube) {
      if (!youtubeId) return;
      // videoId prop 変更で内部的に読み替わるが、seekが効くよう少し遅延
      setTimeout(() => {
        try {
          ytRef.current?.seekTo?.(startPos, true);
          setYtPlaying(true);
        } catch {}
      }, 200);
      return;
    }

    // URL
    setYtPlaying(false);
    try {
      urlPlayer.currentTime = startPos;
      urlPlayer.play();
    } catch {}
  }, [currentIndex, currentClip?.uid, currentVideo?.id, isYoutube, youtubeId]);

  // 終端判定して次へ（複数動画またぎ）
  useEffect(() => {
    if (finished) return;

    const timer = setInterval(async () => {
      const idx = currentIndexRef.current;
      const clip = playlist[idx];
      if (!clip) return;

      const isLast = !playlist[idx + 1];
      const endLimit = isLast ? clip.endSec : Math.max(clip.endSec - PLAYBACK_MARGIN_END, clip.startSec);

      const v = videosById[clip.videoId];
      const clipIsYoutube = v?.sourceType === 'youtube';

      if (clipIsYoutube) {
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
              try { urlPlayer.pause(); } catch {}
              setFinished(true);
            }
          }
        } catch {}
      }
    }, 200);

    return () => clearInterval(timer);
  }, [playlist, videosById, isUrlPlaying, finished]);

  const playFrom = (index) => {
    if (!playlist[index]) return;
    finishedRef.current = false;
    setFinished(false);
    currentIndexRef.current = index;
    setCurrentIndex(index);
  };

  const toggleSelectTag = (name) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar />
      {!project ? null : (
        <>
          <View style={styles.filterRow}>
            <View style={styles.filterHeader}>
              <Text style={styles.label}>タグで絞り込み（{matchMode}）</Text>
              <TouchableOpacity style={styles.modeBtn} onPress={() => setMatchMode((m) => (m === 'OR' ? 'AND' : 'OR'))}>
                <Text style={styles.modeBtnText}>切替</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearBtn} onPress={() => setSelectedTags(new Set())}>
                <Text style={styles.clearBtnText}>クリア</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.tagButtonsWrap}>
              {tags.length === 0 ? (
                <Text style={styles.small}>タグがありません（タグ付け画面で登録してください）</Text>
              ) : (
                tags.map((t) => {
                  const name = t?.name;
                  if (!name) return null;
                  const on = selectedTags.has(name);
                  return (
                    <TouchableOpacity
                      key={t.id || name}
                      style={[styles.tagBtn, on ? styles.tagBtnActive : styles.tagBtnInactive]}
                      onPress={() => toggleSelectTag(name)}
                    >
                      <Text style={[styles.tagBtnText, on ? styles.tagBtnTextActive : styles.tagBtnTextInactive]}>{name}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            <Text style={styles.small}>一致: {playlist.length} 件 / 集約イベント: {allClips.length} 件</Text>
          </View>

          {/* Player */}
          <View style={styles.playerBox}>
            {currentVideo ? (
              isYoutube ? (
                youtubeId ? (
                  <YoutubePlayer
                    ref={ytRef}
                    height={220}
                    videoId={youtubeId}
                    play={ytPlaying && !finished}
                    onChangeState={(s) => {
                      if (finishedRef.current && (s === 'playing' || s === 'buffering')) {
                        try { ytRef.current?.pauseVideo?.(); } catch {}
                        setYtPlaying(false);
                      }
                    }}
                  />
                ) : (
                  <View style={styles.playerFallback}>
                    <Text style={styles.playerFallbackText}>YouTube ID が取得できません</Text>
                  </View>
                )
              ) : (
                <VideoView
                  player={urlPlayer}
                  style={styles.video}
                  contentFit="contain"
                  nativeControls
                  fullscreenOptions={{ enabled: true }}
                  allowsPictureInPicture
                />
              )
            ) : (
              <View style={styles.playerFallback}>
                <Text style={styles.playerFallbackText}>タグを選択してください</Text>
              </View>
            )}
          </View>

          {/* Playlist */}
          <FlatList
            data={playlist}
            keyExtractor={(c) => c.uid}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={[styles.clipItem, index === currentIndex && styles.clipItemActive]}
                onPress={() => playFrom(index)}
              >
                <Text style={styles.clipText}>
                  #{index + 1} [{item.startSec.toFixed(1)}s - {item.endSec.toFixed(1)}s]（{item.title}） {item.tagTypes?.join(', ')}
                </Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
            ListEmptyComponent={<Text style={{ padding: 12 }}>タグを選択してください（または一致なし）</Text>}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF' },

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

  playerBox: { backgroundColor: '#000', height: 220 },
  video: { width: '100%', height: 220, backgroundColor: '#000' },
  playerFallback: { height: 220, justifyContent: 'center', alignItems: 'center' },
  playerFallbackText: { color: '#fff', fontWeight: 'bold' },

  clipItem: { backgroundColor: '#fff', padding: 10, borderRadius: 10, marginVertical: 6 },
  clipItemActive: { borderWidth: 2, borderColor: '#0077cc' },
  clipText: { color: '#333' },
});
