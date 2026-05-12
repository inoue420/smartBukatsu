// app.config.js（CJS版・.env.local対応）
const path = require("path");
const dotenvFlow = require("dotenv-flow");
const dotenvExpand = require("dotenv-expand");
const appJson = require("./app.json");

dotenvExpand.expand(
  dotenvFlow.config({
    path: path.resolve(__dirname),
    default_node_env: "development",
  })
);

// 開発中の確認用。本番提出前には削除推奨
console.log("========== 環境変数のチェック ==========");
console.log(
  "APIキーは入ってる？: ",
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ? "YES" : "NO"
);
console.log("=======================================");

module.exports = ({ config }) => {
  return {
    ...config,
    ...appJson.expo,

    // 明示しておくと development build のURL scheme事故を減らせます
    scheme: "smartbukatsu",

    extra: {
      ...(config.extra || {}),
      ...(appJson.expo.extra || {}),

      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,

      eas: {
        projectId: "e741f7bd-7361-4112-aa43-06b192f2be13",
      },
    },
  };
};