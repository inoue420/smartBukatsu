import { Linking, Platform } from "react-native";

export async function openGuideUrl(url) {
  if (Platform.OS === "android") {
    // Keep a visible close button and return to the existing app task.
    // Load the native module only on Android; other platforms keep Linking.
    const { openBrowserAsync } = require("expo-web-browser");
    return openBrowserAsync(url, {
      createTask: false,
      enableBarCollapsing: false,
      showTitle: true,
    });
  }

  return Linking.openURL(url);
}
