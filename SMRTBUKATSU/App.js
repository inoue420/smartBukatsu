import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import VideoListScreen from './src/screens/VideoListScreen';
import AddVideoScreen from './src/screens/AddVideoScreen';
import TaggingScreen from './src/screens/TaggingScreen';
import HighlightPlayerScreen from './src/screens/HighlightPlayerScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="VideoList">
        <Stack.Screen name="VideoList" component={VideoListScreen} options={{ title: '動画一覧' }} />
        <Stack.Screen name="AddVideo" component={AddVideoScreen} options={{ title: '動画追加' }} />
        <Stack.Screen name="Tagging" component={TaggingScreen} options={{ title: 'タグ付け' }} />
        <Stack.Screen name="Highlights" component={HighlightPlayerScreen} options={{ title: 'ハイライト再生' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
