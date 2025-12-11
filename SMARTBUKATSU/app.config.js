// app.config.js（CJS版・.env.local対応）
const path = require('path');
const dotenvFlow = require('dotenv-flow');
const dotenvExpand = require('dotenv-expand');
const appJson = require('./app.json');

dotenvExpand.expand(
  dotenvFlow.config({
    path: path.resolve(__dirname),   // ルート直下の .env* を読む（.env.local 最優先）
    default_node_env: 'development',
  })
);

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
    },
  },
};
