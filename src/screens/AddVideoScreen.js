// src/screens/AddVideoScreen.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import YoutubePlayer from 'react-native-youtube-iframe';

import { addVideo, addEvent, subscribeEvents } from '../services/firestoreService';
import { useAuth } from '../contexts/AuthContext';

 function parseYouTubeId(rawUrl) {
   const url = (rawUrl || '').trim();
   if (!url) return null;
 
   try {
     // youtu.be/<id> / youtube.com/watch?v=<id> / shorts / embed / live などをサポート
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
 
export default function AddVideoScreen() {
  const { activeTeamId, isAdmin, user } = useAuth();
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
  const [savedVideoId, setSavedVideoId] = useState(null);
  const [sourceType, setSourceType] = useState('url'); // 'url' | 'youtube'
  const [ytId, setYtId] = useState(null);

  // タグ付け用
  const [tagText, setTagText] = useState('');
  const [pendingStart, setPendingStart] = useState(null);
  const [events, setEvents] = useState([]);
  const [previewEndSec, setPreviewEndSec] = useState(null);

  // 再生用
  const ytRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  // URL(MP4/HLS) 再生用（expo-video）
  // nullソースで作っておいて、必要になったら replace() で差し替える方式（公式の推奨パターン）:contentReference[oaicite:3]{index=3}
  const urlPlayer = useVideoPlayer(null);
  const { isUrlPlaying } = useEvent(urlPlayer, 'playingChange', { isUrlPlaying: urlPlayer.playing });


  // URL入力のたびに種別判定
  useEffect(() => {
   const trimmed = (videoUrl || '').trim();
   const looksLikeYouTube = /youtu\.be|youtube\.com/.test(trimmed);
   const id = parseYouTubeId(trimmed);

   if (looksLikeYouTube) {
     // YouTubeっぽいなら YouTube扱いに寄せる（ytIdが取れない場合は後段で警告表示）
     setSourceType('youtube');
     setYtId(id);
     try { urlPlayer.pause(); } catch {}
   } else {
     setSourceType('url');
     setYtId(null);
   }
  }, [videoUrl]);
 
   // URL(MP4/HLS) のときだけ、player にソース反映
   useEffect(() => {
     if (sourceType !== 'url') return;
     const url = (videoUrl || '').trim();
     if (!url) return;
     try {
       urlPlayer.replace(url);
     } catch {}
   }, [sourceType, videoUrl]);

  // 保存
  const handleSave = async () => {
    if (!isAdmin) {
      Alert.alert('権限がありません', '動画追加は管理者のみ可能です');
      return;
    }
    if (!title || !videoUrl) {
      Alert.alert('未入力', 'タイトルと動画URLを入力してください');
      return;
    }
    try {
      const vid = await addVideo(activeTeamId, {
        title,
        videoUrl,
        sourceType,
        youtubeId: sourceType === 'youtube' ? ytId : null,
        createdBy: user.uid,
      });
      setSavedVideoId(vid);
      Alert.alert('保存成功', 'このページでそのまま再生・タグ付けできます');
    } catch (e) {
      console.error(e);
      Alert.alert('保存失敗', 'もう一度お試しください');
    }
  };

  // イベント購読（保存後）
  useEffect(() => {
    if (!savedVideoId) return;
    const unsub = subscribeEvents(activeTeamId, savedVideoId, setEvents);
    return () => unsub && unsub();
  }, [activeTeamId, savedVideoId]);

  // 現在秒取得（expo-video or YouTube）
  const getCurrentSec = async () => {
    if (sourceType === 'youtube') {
      try {
        const t = await ytRef.current?.getCurrentTime();
        return t ?? 0;
      } catch {
        return 0;
      }
    } else {
       return urlPlayer?.currentTime ?? 0;
    }
  };

  const handleTagStart = async () => {
    const t = await getCurrentSec();
    setPendingStart(t);
  };

  const handleTagEnd = async () => {
    if (!savedVideoId) {
      Alert.alert('先に保存', 'タグ付けするには動画を保存してください');
      return;
    }
    if (pendingStart == null) {
      Alert.alert('開始が未記録', '「開始」ボタンを先に押してください');
      return;
    }
    const tags = splitTags(tagText);
    if (!tags.length) {
      Alert.alert('タグ未入力', 'タグを入力してください（例：シュート,10番）');
      return;
    }
    const endSec = await getCurrentSec();
    if (endSec <= pendingStart) {
      Alert.alert('範囲エラー', '終了時刻が開始より前です');
      return;
    }
    await addEvent(activeTeamId, savedVideoId, {
      tagTypes: tags,
      startSec: pendingStart,
      endSec,
      note: '',
      createdBy: user?.uid || 'anon',
    });
    setPendingStart(null);
    setTagText('');
  };

  const playFullFromStart = async () => {
    setPreviewEndSec(null);
    if (sourceType === 'youtube') {
      if (!ytId) return;
      ytRef.current?.seekTo?.(0, true);
      setPlaying(true);
    } else {
      try {
        urlPlayer.currentTime = 0; // expo-video: currentTimeをセットでシーク可能
        urlPlayer.play();
      } catch {}
    }
  };

  const playClip = async (startSec, endSec) => {
    setPreviewEndSec(endSec);
    if (sourceType === 'youtube') {
      if (!ytId) return;
      ytRef.current?.seekTo?.(Math.max(startSec, 0), true);
      setPlaying(true);
    } else {
      try {
        urlPlayer.currentTime = Math.max(startSec, 0);
        urlPlayer.play();
      } catch {}
    }
  };

  // クリップ終端で自動停止（YouTube / URL共通）
  useEffect(() => {
    if (previewEndSec == null) return;
    const timer = setInterval(async () => {
      if (sourceType === 'youtube') {
        if (!playing) return;
        try {
          const t = await ytRef.current?.getCurrentTime?.();
          if (typeof t === 'number' && t >= previewEndSec) {
            setPlaying(false);
            setPreviewEndSec(null);
          }
        } catch {}
      } else {
        if (!isUrlPlaying) return;
        try {
          if ((urlPlayer?.currentTime ?? 0) >= previewEndSec) {
            urlPlayer.pause();
            setPreviewEndSec(null);
          }
        } catch {}
      }
    }, 200);
    return () => clearInterval(timer);
  }, [previewEndSec, sourceType, playing, isUrlPlaying]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <FlatList
        data={savedVideoId ? events : []}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.contentContainer}
        ListHeaderComponent={
          <View>
            {/* 入力エリア */}
            <Text style={styles.label}>タイトル</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="例）2025/12/11_練習" />

            <Text style={styles.label}>動画URL（YouTube または MP4/HLS）</Text>
            <TextInput
              style={styles.input}
              value={videoUrl}
              onChangeText={(t) => setVideoUrl(t.trim())}
              placeholder="https://..."
            />

            <View style={styles.row}>
              <Text style={styles.small}>検出された種類: {sourceType === 'youtube' ? 'YouTube' : 'URL(MP4/HLS)'}</Text>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>{savedVideoId ? '上書き保存' : '保存'}</Text>
            </TouchableOpacity>

            {/* 再生エリア */}
            <View style={{ height: 12 }} />
            <Text style={styles.sectionTitle}>プレビュー & タグ付け</Text>

            <View style={styles.playerBox}>
              {sourceType === 'youtube' ? (
                ytId ? (
                  <>
                    <YoutubePlayer
                      ref={ytRef}
                      height={220}
                      videoId={ytId}
                      play={playing}
                      onChangeState={(s) => {
                        if (s === 'ended') setPlaying(false);
                      }}
                    />
                    <View style={styles.row}>
                      <TouchableOpacity style={styles.playBtn} onPress={playFullFromStart}>
                        <Text style={styles.playBtnText}>⟲ 最初から</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.playBtn} onPress={() => setPlaying(true)}>
                        <Text style={styles.playBtnText}>▶ 再生</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.playBtn} onPress={() => setPlaying(false)}>
                        <Text style={styles.playBtnText}>⏸ 一時停止</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <View style={{ height: 220, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
                    <Text style={{ color: '#fff', fontWeight: 'bold' }}>YouTubeリンクを認識できません</Text>
                    <Text style={{ color: '#fff', marginTop: 6, textAlign: 'center' }}>
                      例）https://www.youtube.com/watch?v=XXXX または https://youtu.be/XXXX
                    </Text>
                  </View>
                )
              ) : (
                <>
                  <VideoView
                    style={styles.video}
                    player={urlPlayer}
                    nativeControls
                    contentFit="contain"
                    allowsFullscreen
                  />
                  <View style={styles.row}>
                    <TouchableOpacity style={styles.playBtn} onPress={playFullFromStart}>
                      <Text style={styles.playBtnText}>⟲ 最初から</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.playBtn}
                      onPress={() => {
                        try {
                          if (isUrlPlaying) urlPlayer.pause();
                          else urlPlayer.play();
                        } catch {}
                      }}
                    >
                      <Text style={styles.playBtnText}>{isUrlPlaying ? '⏸ 一時停止' : '▶ 再生'}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            {/* タグUI（自由入力） */}
            <Text style={styles.label}>タグ（カンマ区切りOK）</Text>
            <TextInput
              style={styles.input}
              value={tagText}
              onChangeText={setTagText}
              placeholder="例）シュート,10番 / パスミス / GK"
            />

            <View style={styles.row}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleTagStart}>
                <Text style={styles.actionBtnText}>タグ開始</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.endBtn]} onPress={handleTagEnd}>
                <Text style={styles.actionBtnText}>タグ終了</Text>
              </TouchableOpacity>
            </View>

            {pendingStart != null && (
              <Text style={styles.small}>開始記録: {pendingStart.toFixed(2)}s</Text>
            )}

            <Text style={styles.sectionTitle}>記録済みイベント</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity style={styles.eventItem} onPress={() => playClip(item.startSec, item.endSec)}>
            <Text style={styles.eventText}>
              #{index + 1} [{item.startSec.toFixed(1)}s - {item.endSec.toFixed(1)}s] {item.tagTypes?.join(', ')}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          savedVideoId ? (
            <Text style={{ paddingHorizontal: 8 }}>まだありません</Text>
          ) : (
            <Text style={{ paddingHorizontal: 8, color: '#555' }}>※ 保存するとイベント一覧が表示されます</Text>
          )
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF' },
  contentContainer: { padding: 16, paddingBottom: 80 },
  label: { marginTop: 8, fontWeight: 'bold' },
  input: { backgroundColor: '#fff', padding: 10, borderRadius: 8, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  small: { color: '#333' },

  saveBtn: { marginTop: 8, backgroundColor: '#0077cc', padding: 12, borderRadius: 8, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },

  sectionTitle: { marginVertical: 8, fontWeight: 'bold' },
  playerBox: { backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' },
  video: { width: '100%', height: 220, backgroundColor: '#000' },


  actionBtn: { flex: 1, marginHorizontal: 8, backgroundColor: '#0077cc', borderRadius: 8, alignItems: 'center', padding: 12 },
  endBtn: { backgroundColor: '#cc3300' },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },

  playBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', paddingVertical: 8, paddingHorizontal: 12, marginHorizontal: 6, borderRadius: 8 },
  playBtnText: { color: '#0077cc', fontWeight: 'bold' },

  eventItem: { backgroundColor: '#fff', padding: 8, borderRadius: 6, marginVertical: 4 },
  eventText: { color: '#333' },
});
