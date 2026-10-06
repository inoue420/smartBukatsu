import { doc, getDoc, getDocFromServer } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, cloudFunctions } from "../firebase";
import { workspaceReactionReceiptId } from "../utils/workspaceReactions";

export async function getOwnWorkspaceReaction(teamId, postId, uid) {
  if (!teamId || !postId || !uid || auth.currentUser?.uid !== uid) {
    throw new Error("ログイン情報を確認してください。");
  }
  const snapshot = await getDoc(doc(db, "users", uid, "workspaceReactionReceipts",
    workspaceReactionReceiptId(teamId, postId)));
  return snapshot.exists() ? snapshot.data().emoji || null : null;
}

export async function getWorkspaceReactionDetails(teamId, postId) {
  // A server read rechecks permissions on every opening, including after a role change.
  const snapshot = await getDocFromServer(doc(db, "teams", teamId,
    "workspacePostReactionDetails", postId));
  return snapshot.exists() ? snapshot.data().reactors || {} : {};
}

export async function sendWorkspaceReaction(teamId, postId, emoji) {
  const response = await httpsCallable(cloudFunctions, "sendWorkspaceReaction")({ teamId, postId, emoji });
  return response.data;
}
