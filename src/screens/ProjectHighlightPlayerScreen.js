import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, StatusBar, useWindowDimensions } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import YoutubePlayer from 'react-native-youtube-iframe';
import * as ScreenOrientation from 'expo-screen-orientation';

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
  const { width, height } = useWindowDimensions();

  const ytRef = useRef(null);
  const currentIndexRef = useRef(0);
  const finishedRef = useRef(false);
  const remountedAfterFinishRef = useRef(false);
  const finishAtRef = useRef(null);
  const ytReadyRef = useRef(false);
  const pendingYtStartRef = useRef(null);
  const pendingYtUidRef = useRef(null);
  const pendingUrlStartRef = useRef(null);
  const pendingUrlUidRef = useRef(null);
  const lastLoadedUrlRef = useRef(null);

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
  const [landscapeMode, setLandscapeMode] = useState(false);
  const [playerKey, setPlayerKey] = useState(0); // YouTube強制停止用（再マウント）

  const { fsVideoW } = useMemo(() => {
    const uiMin = 280;
    const ideal = Math.round((height * 16) / 9);
    let vw = ideal;
    if (width - vw < uiMin) vw = width - uiMin;
    vw = Math.max(240, Math.min(vw, Math.floor(width * 0.8)));
    return { fsVideoW: vw };
  }, [width, height]);

  // URL(MP4/HLS) 再生用
  const urlPlayer = useVideoPlayer(null);
  const { isUrlPlaying } = useEvent(urlPlayer, 'playingChange', { isUrlPlaying: urlPlayer.playing });
  const { urlStatus } = useEvent(urlPlayer, 'statusChange', { urlStatus: urlPlayer.status });

  const replaceUrlSource = async (url) => {
    try {
      if (typeof urlPlayer?.replaceAsync === 'function') await urlPlayer.replaceAsync(url);
      else urlPlayer.replace(url);
    } catch {}
  };

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
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

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
    remountedAfterFinishRef.current = false;
    finishAtRef.current = null;
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

  // YouTube の動画が切り替わったら「ready」をリセット（初回seekの取りこぼし防止）
  useEffect(() => {
    ytReadyRef.current = false;
  }, [youtubeId, playerKey]);
  
  // 動画切替時：URLなら replace、YouTubeならURL停止
  useEffect(() => {
    if (!currentVideo) return;
    if (currentVideo.sourceType === 'youtube') {
      try { urlPlayer.pause(); } catch {}
      lastLoadedUrlRef.current = null;
      return;
    }
    const url = (currentVideo.videoUrl || '').trim();
    if (!url) return;
    if (lastLoadedUrlRef.current === url) return;
    lastLoadedUrlRef.current = url;
    replaceUrlSource(url);
  }, [currentVideo]);

  // クリップ開始シーク
  useEffect(() => {
    if (!currentClip || !currentVideo) return;

    finishedRef.current = false;
    remountedAfterFinishRef.current = false;
    finishAtRef.current = null;
    setFinished(false);
    currentIndexRef.current = currentIndex;

    const startPos = Math.max(currentClip.startSec - PLAYBACK_MARGIN_START, 0);

    if (isYoutube) {
      if (!youtubeId) return;
      // ✅ 動画切替直後は onReady 前に seekTo が落ちることがあるので保留して確実に適用
      pendingYtStartRef.current = startPos;
      pendingYtUidRef.current = currentClip.uid;

      // 先に play=true になると 0秒から動きがちなので、ready までは止める
      if (!ytReadyRef.current) {
        setYtPlaying(false);
        return;
      }
      try { ytRef.current?.seekTo?.(startPos, true); } catch {}
      setYtPlaying(true);
      pendingYtStartRef.current = null;
      pendingYtUidRef.current = null;
      return;
    }

    // URL
    setYtPlaying(false);
    pendingUrlStartRef.current = startPos;
    pendingUrlUidRef.current = currentClip.uid;
    if (urlStatus !== 'readyToPlay') {
      try { urlPlayer.pause(); } catch {}
      return;
    }
    try { urlPlayer.currentTime = startPos; } catch {}
    try { urlPlayer.play(); } catch {}
    pendingUrlStartRef.current = null;
    pendingUrlUidRef.current = null;
  }, [currentIndex, currentClip?.uid, currentVideo?.id, isYoutube, youtubeId, urlStatus]);

  // ✅ URLプレイヤーが ready になった瞬間に、保留していたシーク＆再生を適用（動画切替直後の1発目対策）
  useEffect(() => {
    if (isYoutube) return;
    if (urlStatus !== 'readyToPlay') return;
    if (!currentClip) return;
    const uid = pendingUrlUidRef.current;
    const pos = pendingUrlStartRef.current;
    if (uid !== currentClip.uid) return;
    if (typeof pos !== 'number') return;
    try { urlPlayer.currentTime = pos; } catch {}
    try { urlPlayer.play(); } catch {}
    pendingUrlStartRef.current = null;
    pendingUrlUidRef.current = null;
  }, [urlStatus, isYoutube, currentClip?.uid]);

  // 終端判定して次へ（複数動画またぎ）
  useEffect(() => {
    if (finished) return;

    const timer = setInterval(async () => {
      const idx = currentIndexRef.current;
      const clip = playlist[idx];
      if (!clip) return;

      const isLast = !playlist[idx + 1];
      // 最後のクリップは endSec で止める（マージンは引かない）
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
              finishAtRef.current = endLimit;
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
              try { urlPlayer.pause(); } catch {}
              setFinished(true);
            }
          }
        } catch {}
      }
    }, 200);

    return () => clearInterval(timer);
  }, [playlist, videosById, isUrlPlaying, finished]);

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
            if (typeof fin === 'number' && typeof cur === 'number' && cur > fin + 0.8) {
              remountedAfterFinishRef.current = true;
              setPlayerKey((k) => k + 1);
            }
          } catch {
            remountedAfterFinishRef.current = true;
            setPlayerKey((k) => k + 1);
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
    remountedAfterFinishRef.current = false;
    finishAtRef.current = null;
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
    if (!currentVideo) {
      return (
        <View style={styles.playerFallback}>
          <Text style={styles.playerFallbackText}>タグを選択してください</Text>
        </View>
      );
    }

    if (isYoutube) {
      return youtubeId ? (
        <View style={landscape ? [styles.fsVideoWrap, { width: fsVideoW }] : styles.videoWrap}>
          <YoutubePlayer
            key={`${youtubeId || 'yt'}-${playerKey}`}
            ref={ytRef}
            height={landscape ? Math.max(200, height) : 220}
            width={landscape ? fsVideoW : undefined}
            videoId={youtubeId || ''}
            play={ytPlaying && !finished}
            initialPlayerParams={landscape ? { preventFullScreen: true } : undefined}
            onReady={() => {
              ytReadyRef.current = true;
              // ✅ 動画切替直後の「最初のタグ」が効かない対策：ready後にseek/playを確実に適用
              const uid = pendingYtUidRef.current;
              const pos = pendingYtStartRef.current;
              if (!currentClip) return;
              if (uid !== currentClip.uid) return;
              if (typeof pos !== 'number') return;
              if (finishedRef.current) return;
              try { ytRef.current?.seekTo?.(pos, true); } catch {}
              setYtPlaying(true);
              pendingYtStartRef.current = null;
              pendingYtUidRef.current = null;
            }}
            onChangeState={(s) => {
              // finished なのに再度 playing/buffering になる個体差対策（より強く）
              if (finishedRef.current && (s === 'playing' || s === 'buffering')) {
                if (!remountedAfterFinishRef.current) {
                  remountedAfterFinishRef.current = true;
                  setPlayerKey((k) => k + 1);
                }
                try { ytRef.current?.pauseVideo?.(); } catch {}
                setYtPlaying(false);
              }
              if (s === 'ended') setYtPlaying(false);
            }}
          />
        </View>
      ) : (
        <View style={styles.playerFallback}>
          <Text style={styles.playerFallbackText}>YouTube ID が取得できません</Text>
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
      {!project ? null : (
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
                    ListHeaderComponent={
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
                        <Text style={[styles.label, { marginTop: 8 }]}>クリップ一覧</Text>
                      </View>
                    }
                    contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
                    ListEmptyComponent={<Text style={{ padding: 12 }}>タグを選択してください（または一致なし）</Text>}
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.fsCloseBtn} onPress={closeLandscapeMode}>
                <Text style={styles.fsCloseBtnText}>閉じる</Text>
              </TouchableOpacity>
            </View>
          ) : (
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
                  <TouchableOpacity style={styles.landscapeBtn} onPress={openLandscapeMode}>
                    <Text style={styles.landscapeBtnText}>横</Text>
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
                {renderPlayer({ landscape: false })}
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
  landscapeBtn: { marginLeft: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  landscapeBtnText: { color: '#0077cc', fontWeight: 'bold' },

  tagButtonsWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  tagBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, marginRight: 8, marginBottom: 8 },
  tagBtnActive: { backgroundColor: '#0077cc', borderColor: '#0077cc' },
  tagBtnInactive: { backgroundColor: '#fff', borderColor: '#0077cc' },
  tagBtnText: { fontWeight: 'bold' },
  tagBtnTextActive: { color: '#fff' },
  tagBtnTextInactive: { color: '#0077cc' },

  playerBox: { backgroundColor: '#000', height: 220 },
  video: { width: '100%', height: 220, backgroundColor: '#000' },
  videoWrap: { width: '100%', height: 220, backgroundColor: '#000' },
  playerFallback: { height: 220, justifyContent: 'center', alignItems: 'center' },
  playerFallbackText: { color: '#fff', fontWeight: 'bold' },

  clipItem: { backgroundColor: '#fff', padding: 10, borderRadius: 10, marginVertical: 6 },
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
