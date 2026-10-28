import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Linking, Platform } from "react-native";
import { createReviewHistory } from "./appReviewPolicy";
import { reviewPresentationGate } from "./reviewPresentationGate";

// These are the existing public store listings used by the landing page.
export const APP_REVIEW_URLS = Object.freeze({
  android: "https://play.google.com/store/apps/details?id=com.sharprise.smartbukatsu&showAllReviews=true",
  ios: "https://apps.apple.com/app/id6764191653?action=write-review",
});
const history = createReviewHistory({ storage: AsyncStorage });
const supported = () => Platform.OS === "android" || Platform.OS === "ios";

export async function recordReviewUsage(uid) {
  if (!supported()) return;
  try { await history.recordUse(uid); } catch { /* Storage failure must not interrupt normal use. */ }
}

export async function requestAppReview(uid, isSafe) {
  if (!supported() || !isSafe() || !reviewPresentationGate.canReview()) return false;
  // Never ask for a production review from a development/screenshot app.
  if (Application.applicationId !== "com.sharprise.smartbukatsu") return false;
  const release = reviewPresentationGate.acquire("review");
  if (!release) return false;
  let requested = false;
  try {
    // Older installed development clients may not have this native module yet.
    const StoreReview = require("expo-store-review");
    return await history.attempt(uid, () => isSafe() && !reviewPresentationGate.isBlocked(), async () => {
      requested = true;
      await StoreReview.requestReview();
    }, () => StoreReview.isAvailableAsync());
  } catch {
    return false;
  } finally {
    // iOS may resolve immediately while its system sheet is still visible.
    release(requested);
  }
}

export async function openAppReviewStore() {
  const url = APP_REVIEW_URLS[Platform.OS];
  if (!url) return false;
  await Linking.openURL(url);
  return true;
}
