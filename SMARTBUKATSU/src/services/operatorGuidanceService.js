import { collection, doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, cloudFunctions } from "../firebase";

export const GUIDANCE_STATUS = {
  processing: "処理中・結果未確定", accepted: "配信受付", unavailable: "送信不可", failed: "失敗",
};
export const GUIDANCE_REASON = {
  creator_unknown: "最初の作成者が不明です", same_account: "同じアカウントをまとめました",
  owner_unknown: "現在の所有者を確認できません。一覧を更新してください",
  initial_recorded_or_processing: "初回案内の記録あり、または送信処理中です",
  membership_changed: "所有者または所属が変わりました。一覧を更新してください", operator_removed: "運営権限を確認できません",
  notifications_off: "通知設定がOFFです", no_device: "通知可能な端末がありません",
  device_not_registered: "登録端末で送信できませんでした", response_unknown: "配信受付の応答が不明です",
  push_failed: "プッシュ送信に失敗しました", result_unknown: "処理結果が不明です。履歴を確認してください",
  notification_exists_or_membership_changed: "保存済み、または所属を確認できません",
  summary_not_ready: "既存通知の集計準備が必要です。受信者がアプリで通知センターを開いた後に再送してください",
};
async function call(name, uid, data = {}) {
  if (!uid || auth.currentUser?.uid !== uid) throw new Error("ログイン状態が変わりました。");
  const response = await httpsCallable(cloudFunctions, name)({ ...data, expectedUid: uid });
  if (auth.currentUser?.uid !== uid) throw new Error("ログイン状態が変わりました。");
  return response.data;
}
export const getOperatorGuidanceAccess = (uid) => call("getOperatorGuidanceAccess", uid);
export const listOperatorGuidanceTargets = (uid, cursor = null) => call("listOperatorGuidanceTargets", uid, { cursor });
export const listOperatorGuidanceHistory = (uid, cursor = null) => call("listOperatorGuidanceHistory", uid, { cursor });
export const getOperatorGuidanceUsage = (uid, teamId) => call("getOperatorGuidanceUsage", uid, { teamId });
export const listOperatorGuidanceInbox = (uid, cursor = null) => call("listOperatorGuidanceInbox", uid, { cursor });
export const getOperatorGuidanceConversation = (uid, historyId, asOperator = false, cursor = null) => call("getOperatorGuidanceConversation", uid, { historyId, asOperator, cursor });
export const replyOperatorGuidance = (uid, request) => call("replyOperatorGuidance", uid, request);
export const sendOperatorGuidance = (uid, request) => call("sendOperatorGuidance", uid, request);
export const createGuidanceRequestId = () => doc(collection(db, "operatorGuidanceRequests")).id;
export function guidanceDraft(template) {
  const content = template?.content;
  return content ? { title: content.title, introduction: content.introduction,
    features: content.features.map(({ topic, label }) => ({ topic, label })), closing: content.closing } : null;
}
export function guidanceDraftMessage(content) {
  const normalized = { title: content.title.trim(), introduction: content.introduction.trim(),
    features: content.features.map(({ topic, label }) => ({ topic, label: label.trim() })), closing: content.closing.trim() };
  return { title: normalized.title, body: [normalized.introduction, normalized.features.map(({ label }) => `・${label}`).join("\n"), normalized.closing].filter(Boolean).join("\n\n"), content: normalized };
}
export function guidanceConversationTarget(notification = {}) {
  const params = notification.target?.params || {};
  const legacyId = typeof notification.id === "string" && notification.id.startsWith("guidance_") && !notification.id.startsWith("guidance_reply_") ? notification.id.slice(9) : "";
  const historyId = params.historyId || notification.source?.historyId || legacyId;
  return typeof historyId === "string" && historyId.length > 0 && historyId.length <= 128 && !historyId.includes("/")
    ? { screen: "OperatorGuidanceConversation", params: { historyId, asOperator: params.asOperator === true } }
    : { screen: "OperatorGuidanceInbox", params: {} };
}
export function guidanceAge(createdAt, now = Date.now()) {
  if (!createdAt) return "作成日時不明";
  const hours = Math.max(0, (now - createdAt) / 3600000);
  return `${Math.floor(hours / 24)}日経過・${hours >= 72 ? "72時間経過" : "72時間未満"}`;
}
