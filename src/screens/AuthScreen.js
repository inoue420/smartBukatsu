// /src/screens/AuthScreen.js
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      Alert.alert('未入力', 'メールアドレスとパスワードを入力してください');
      return;
    }
    try {
      if (mode === 'signin') await signIn(email, password);
      else await signUp(email, password);
    } catch (e) {
      Alert.alert('エラー', e?.message ? String(e.message) : String(e));
    }
  };

  const handleReset = async () => {
    if (!email.trim()) {
      Alert.alert('未入力', 'メールアドレスを入力してください');
      return;
    }
    try {
      await resetPassword(email);
      Alert.alert('送信しました', 'パスワードリセットメールを送信しました');
    } catch (e) {
      Alert.alert('エラー', e?.message ? String(e.message) : String(e));
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>ログイン</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="email@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="password"
        secureTextEntry
      />

      <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit}>
        <Text style={styles.primaryBtnText}>{mode === 'signin' ? 'ログイン' : '新規登録'}</Text>
      </TouchableOpacity>

      <View style={styles.row}>
        <TouchableOpacity style={styles.linkBtn} onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          <Text style={styles.linkText}>{mode === 'signin' ? '新規登録へ' : 'ログインへ'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={handleReset}>
          <Text style={styles.linkText}>PWリセット</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E0FFFF', padding: 16, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginTop: 10 },
  primaryBtn: { marginTop: 14, backgroundColor: '#0077cc', padding: 12, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: 'bold' },
  row: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between' },
  linkBtn: { padding: 8 },
  linkText: { color: '#0077cc', fontWeight: 'bold' },
});
