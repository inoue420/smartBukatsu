import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { createProject, subscribeProjects } from '../services/firestoreService';

export default function ProjectListScreen({ navigation }) {
  const { activeTeamId, isAdmin, user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!activeTeamId) return;
    const unsub = subscribeProjects(activeTeamId, setProjects);
    return () => unsub?.();
  }, [activeTeamId]);

  const onCreate = useCallback(async () => {
    if (!isAdmin) {
      Alert.alert('権限がありません', 'プロジェクト作成は管理者のみ可能です');
      return;
    }
    try {
      const projectId = await createProject(activeTeamId, { name, createdBy: user.uid });
      setName('');
      navigation.navigate('ProjectDetail', { projectId });
    } catch (e) {
      Alert.alert('エラー', e?.message ? String(e.message) : String(e));
    }
  }, [isAdmin, activeTeamId, name, user?.uid]);

  return (
    <View style={styles.container}>
      <View style={styles.createBox}>
        <Text style={styles.label}>新規プロジェクト</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={name}
            onChangeText={setName}
            placeholder="例）2025/12/練習試合 vs ○○"
          />
          <TouchableOpacity style={[styles.btn, { opacity: isAdmin ? 1 : 0.5 }]} onPress={onCreate}>
            <Text style={styles.btnText}>作成</Text>
          </TouchableOpacity>
        </View>
        {!isAdmin && <Text style={styles.small}>※プロジェクトの作成/編集は管理者のみ</Text>}
      </View>

      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('ProjectDetail', { projectId: item.id })}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.small}>updated: {item.updatedAt?.toDate?.()?.toLocaleString?.() || '-'}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ padding: 12 }}>プロジェクトがありません</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF', padding: 12 },
  createBox: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 12 },
  label: { fontWeight: 'bold', marginBottom: 6 },
  input: { backgroundColor: '#f7ffff', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#bfefff' },
  btn: { backgroundColor: '#009966', paddingHorizontal: 14, justifyContent: 'center', borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 10 },
  title: { fontWeight: 'bold', fontSize: 16 },
  small: { marginTop: 6, color: '#333' },
});
