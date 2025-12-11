import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { addVideo } from '../services/firestoreService';

export default function AddVideoScreen({ navigation }) {
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState(
    // 動作用のサンプルURL（任意で差し替え）— 自前動画のURL推奨
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  );

  const handleSave = async () => {
    if (!title || !videoUrl) {
      Alert.alert('未入力', 'タイトルと動画URLを入力してください');
      return;
    }
    const id = await addVideo({ title, videoUrl, sourceType: 'url' });
    navigation.replace('Tagging', { videoId: id });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>タイトル</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="例）2025/12/03_練習試合" />

      <Text style={styles.label}>動画URL（MP4/HLS推奨）</Text>
      <TextInput style={styles.input} value={videoUrl} onChangeText={setVideoUrl} placeholder="https://..." />

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>保存してタグ付けへ</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF', padding: 16 },
  label: { marginTop: 8, fontWeight: 'bold' },
  input: { backgroundColor: '#fff', padding: 10, borderRadius: 8, marginTop: 4 },
  saveBtn: { marginTop: 16, backgroundColor: '#0077cc', padding: 12, borderRadius: 8, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
});
