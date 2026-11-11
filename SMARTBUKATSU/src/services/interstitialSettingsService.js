import { doc, getDocFromServer } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, cloudFunctions } from "../firebase";
import { DEFAULT_POLICY, normalizePolicy } from "../ads/interstitialPolicy";

function assertAccount(uid) {
  if (!uid || auth.currentUser?.uid !== uid) throw new Error("ログイン状態が変わりました。");
}
export async function fetchInterstitialSettings(uid) {
  assertAccount(uid);
  const snapshot = await getDocFromServer(doc(db, "appConfig", "interstitialAds"));
  assertAccount(uid);
  const settings = snapshot.exists() ? normalizePolicy(snapshot.data()) : { ...DEFAULT_POLICY };
  if (!settings) throw new Error("広告設定を確認できませんでした。");
  let isDebugMember = false;
  // All/off modes do not need any additional membership read.
  if (settings.audience === "debug") {
    const result = await httpsCallable(cloudFunctions, "getInterstitialAdAccess")({ expectedUid: uid });
    assertAccount(uid); isDebugMember = result.data?.allowed === true;
  }
  return { ...settings, isDebugMember };
}
export async function saveInterstitialSettings(uid, settings) {
  assertAccount(uid);
  const normalized = normalizePolicy(settings);
  if (!normalized) throw new Error("表示対象と1～30分の利用時間を指定してください。");
  const result = await httpsCallable(cloudFunctions, "setInterstitialAdSettings")({ ...normalized, expectedUid: uid });
  assertAccount(uid);
  const saved = normalizePolicy(result.data);
  if (!saved) throw new Error("保存結果を確認できませんでした。");
  return saved;
}
