// App.js
import 'react-native-gesture-handler';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import VideoListScreen from './src/screens/VideoListScreen';
import AddVideoScreen from './src/screens/AddVideoScreen'; 
import TaggingScreen from './src/screens/TaggingScreen';
import HighlightPlayerScreen from './src/screens/HighlightPlayerScreen';
import AuthScreen from './src/screens/AuthScreen';
import TeamSetupScreen from './src/screens/TeamSetupScreen';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';


const Stack = createNativeStackNavigator();

function RootNavigator() {
  const { user, loading, activeTeamId } = useAuth();
  if (loading) return null;

  // 未ログイン
  if (!user) {
    return (
      <Stack.Navigator>
        <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'ログイン' }} />
      </Stack.Navigator>
    );
  }

  // ログイン済みだがチーム未設定
  if (!activeTeamId) {
    return (
      <Stack.Navigator>
        <Stack.Screen name="TeamSetup" component={TeamSetupScreen} options={{ title: 'チーム設定' }} />
      </Stack.Navigator>
    );
  }

  // メイン
  return (
    <Stack.Navigator initialRouteName="VideoList">
      <Stack.Screen name="VideoList" component={VideoListScreen} options={{ title: '動画一覧' }} />
      <Stack.Screen name="AddVideo" component={AddVideoScreen} options={{ title: '動画追加' }} />
      <Stack.Screen name="Tagging" component={TaggingScreen} options={{ title: 'タグ付け' }} />
      <Stack.Screen name="Highlights" component={HighlightPlayerScreen} options={{ title: 'ハイライト' }} />
    </Stack.Navigator>
  );
}


export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
