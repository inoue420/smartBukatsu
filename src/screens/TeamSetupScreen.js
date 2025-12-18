// /src/screens/TeamSetupScreen.js

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { createTeam, joinTeamByInvite } from '../services/firestoreService';

export default function TeamSetupScreen() {
  const { user, signOut } = useAuth();
  const [teamName, setTeamName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      Alert.alert('未入力', 'チーム名を入力してください');
      return;
    }
    try {
      await createTeam({ name: teamName.trim(), uid: user.uid });
      // activeTeamId は users/{uid} 更新で自動的に反映される
    } catch (e) {
      Alert.alert('エラー', e?.message ? String(e.message) : String(e));
    }
  };

  const handleJoin = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      Alert.alert('未入力', '招待コードを入力してください');
      return;
    }
    try {
      await joinTeamByInvite({ code, uid: user.uid });
    } catch (e) {
      Alert.alert('参加できません', e?.message ? String(e.message) : String(e));
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>チーム設定</Text>

      <Text style={styles.section}>招待コードで参加</Text>
      <TextInput
        style={styles.input}
        value={inviteCode}
        onChangeText={setInviteCode}
        placeholder="例）AB12CD34"
        autoCapitalize="characters"
      />
      <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin}>
        <Text style={styles.primaryBtnText}>参加</Text>
      </TouchableOpacity>

      <Text style={[styles.section, { marginTop: 18 }]}>チームを作成（作成者は管理者）</Text>
      <TextInput
        style={styles.input}
        value={teamName}
        onChangeText={setTeamName}
        placeholder="例）◯◯高校 ハンド部"
      />
      <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateTeam}>
        <Text style={styles.primaryBtnText}>作成</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={signOut}>
        <Text style={styles.secondaryBtnText}>ログアウト</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF', padding: 16, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 14, textAlign: 'center' },
  section: { fontWeight: 'bold', marginTop: 8 },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginTop: 10 },
  primaryBtn: { marginTop: 12, backgroundColor: '#0077cc', padding: 12, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: 'bold' },
  secondaryBtn: { marginTop: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0077cc', padding: 12, borderRadius: 8, alignItems: 'center' },
  secondaryBtnText: { color: '#0077cc', fontWeight: 'bold' },
});
