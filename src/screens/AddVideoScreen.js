// src/screens/AddVideoScreen.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, FlatList } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import YoutubePlayer from 'react-native-youtube-iframe';

import { addVideo, addEvent, subscribeEvents } from '../services/firestoreService';
import { TAG_PRESETS } from '../constants';

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

export default function AddVideoScreen() {
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
  const [savedVideoId, setSavedVideoId] = useState(null);
  const [sourceType, setSourceType] = useState('url'); // 'url' | 'youtube'
  const [ytId, setYtId] = useState(null);

  // タグ付け用
  const [currentTag, setCurrentTag] = useState(TAG_PRESETS[0]);
  const [pendingStart, setPendingStart] = useState(null);
  const [events, setEvents] = useState([]);

  // 再生用
  const videoRef = useRef(null);
  const [status, setStatus] = useState(null);
  const ytRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  // URL入力のたびに種別判定
  useEffect(() => {
   const trimmed = (videoUrl || '').trim();
   const looksLikeYouTube = /youtu\.be|youtube\.com/.test(trimmed);
   const id = parseYouTubeId(trimmed);

   if (looksLikeYouTube) {
     // YouTubeっぽいなら YouTube扱いに寄せる（ytIdが取れない場合は後段で警告表示）
     setSourceType('youtube');
     setYtId(id);
   } else {
     setSourceType('url');
     setYtId(null);
   }
  }, [videoUrl]);

  // 保存
  const handleSave = async () => {
    if (!title || !videoUrl) {
      Alert.alert('未入力', 'タイトルと動画URLを入力してください');
      return;
    }
    try {
      const vid = await addVideo({
        title,
        videoUrl,
        sourceType,
        createdBy: 'anon',
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
    const unsub = subscribeEvents(savedVideoId, setEvents);
    return () => unsub && unsub();
  }, [savedVideoId]);

  // 現在秒取得（expo-av or YouTube）
  const getCurrentSec = async () => {
    if (sourceType === 'youtube') {
      try {
        const t = await ytRef.current?.getCurrentTime();
        return t ?? 0;
      } catch {
        return 0;
      }
    } else {
       try {
         const st = await videoRef.current?.getStatusAsync?.();
         if (st?.isLoaded) return st.positionMillis / 1000;
       } catch {}
       if (status?.isLoaded) return status.positionMillis / 1000;
       return 0;
    }
  };

  const handleStart = async () => {
    const t = await getCurrentSec();
    setPendingStart(t);
  };

  const handleEnd = async () => {
    if (!savedVideoId) {
      Alert.alert('先に保存', 'タグ付けするには動画を保存してください');
      return;
    }
    if (pendingStart == null) {
      Alert.alert('開始が未記録', '「開始」ボタンを先に押してください');
      return;
    }
    const endSec = await getCurrentSec();
    if (endSec <= pendingStart) {
      Alert.alert('範囲エラー', '終了時刻が開始より前です');
      return;
    }
    await addEvent(savedVideoId, {
      tagTypes: [currentTag],
      startSec: pendingStart,
      endSec,
      note: '',
      createdBy: 'anon',
    });
    setPendingStart(null);
  };

  const renderTag = ({ item }) => {
    const active = currentTag === item;
    return (
      <TouchableOpacity onPress={() => setCurrentTag(item)} style={[styles.tagBtn, active && styles.tagBtnActive]}>
        <Text style={[styles.tagBtnText, active && styles.tagBtnTextActive]}>{item}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
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
         <Video
           ref={videoRef}
           source={{ uri: videoUrl }}
           style={styles.video}
           resizeMode={ResizeMode.CONTAIN}
           useNativeControls
           onPlaybackStatusUpdate={setStatus}
         />
       )}
      </View>

      {/* タグUI */}
      <FlatList
        data={TAG_PRESETS}
        horizontal
        keyExtractor={(t) => t}
        renderItem={renderTag}
        contentContainerStyle={{ paddingHorizontal: 8 }}
        showsHorizontalScrollIndicator={false}
      />

      <View style={styles.row}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleStart}>
          <Text style={styles.actionBtnText}>開始（{currentTag}）</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.endBtn]} onPress={handleEnd}>
          <Text style={styles.actionBtnText}>終了</Text>
        </TouchableOpacity>
      </View>

      {pendingStart != null && (
        <Text style={styles.small}>開始記録: {pendingStart.toFixed(2)}s</Text>
      )}

      {/* 記録済みイベント一覧 */}
      {savedVideoId && (
        <>
          <Text style={styles.sectionTitle}>記録済みイベント</Text>
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
            ListEmptyComponent={<Text style={{ paddingHorizontal: 8 }}>まだありません</Text>}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 20 }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF', padding: 16 },
  label: { marginTop: 8, fontWeight: 'bold' },
  input: { backgroundColor: '#fff', padding: 10, borderRadius: 8, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  small: { color: '#333' },

  saveBtn: { marginTop: 8, backgroundColor: '#0077cc', padding: 12, borderRadius: 8, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },

  sectionTitle: { marginVertical: 8, fontWeight: 'bold' },
  playerBox: { backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' },
  video: { width: '100%', height: 220, backgroundColor: '#000' },

  tagBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 4 },
  tagBtnActive: { backgroundColor: '#0077cc' },
  tagBtnText: { color: '#0077cc', fontWeight: 'bold' },
  tagBtnTextActive: { color: '#fff' },

  actionBtn: { flex: 1, marginHorizontal: 8, backgroundColor: '#0077cc', borderRadius: 8, alignItems: 'center', padding: 12 },
  endBtn: { backgroundColor: '#cc3300' },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },

  playBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', paddingVertical: 8, paddingHorizontal: 12, marginHorizontal: 6, borderRadius: 8 },
  playBtnText: { color: '#0077cc', fontWeight: 'bold' },

  eventItem: { backgroundColor: '#fff', padding: 8, borderRadius: 6, marginVertical: 4 },
  eventText: { color: '#333' },
});
