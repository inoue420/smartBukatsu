import { ref, uploadBytes, getDownloadURL, getMetadata } from "firebase/storage";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db, storage } from "../firebase";
export { prepareDailyReportImageAttachment as prepareTacticalNoteImage } from "./dailyReportAttachmentService";

export async function uploadTacticalNoteImage(teamId, noteId, image) {
  if ([teamId, noteId, image.id].some((part) => !part || part.includes("/")) || !/^[a-zA-Z0-9_-]+$/.test(image.id)) throw new Error("画像の保存先が不正です。");
  const blob = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    xhr.responseType = "blob"; xhr.open("GET", image.localUri, true); xhr.send(null);
  });
  try {
    if (blob.size > 10 * 1024 * 1024) throw new Error("画像は10MB以下にしてください。");
    const storagePath = `tacticalNoteAttachments/${teamId}/${noteId}/${image.id}.jpg`;
    const target = ref(storage, storagePath);
    const uid = auth.currentUser.uid;
    const registration = doc(db, "teams", teamId, "tacticalNotes", noteId, "attachmentUploads", image.id);
    await runTransaction(db, async (transaction) => {
      const existing = (await transaction.get(registration)).data();
      if (existing) {
        if (existing.cleanupClaimedAt) throw new Error("期限切れの画像を回収中です。少し待って保存を再試行してください。");
        if (existing.uploaderUid !== uid || existing.storagePath !== storagePath || existing.size !== blob.size) throw new Error("画像の保存情報が変更されています。画像を選び直してください。");
        return;
      }
      transaction.set(registration, { uploaderUid: uid, storagePath, size: blob.size, createdAt: serverTimestamp() });
    });
    let metadata;
    try { metadata = await getMetadata(target); }
    catch (error) { if (error.code !== "storage/object-not-found") throw error; }
    if (metadata) {
      if (metadata.size !== blob.size || metadata.customMetadata?.uploaderUid !== uid || metadata.customMetadata?.uploadId !== image.id) throw new Error("保存済み画像が一致しません。画像を選び直してください。");
    } else {
      await uploadBytes(target, blob, { contentType: "image/jpeg", customMetadata: { uploaderUid: uid, uploadId: image.id } });
    }
    return { id: image.id, name: image.name, storagePath, size: blob.size,
      downloadUrl: await getDownloadURL(target), width: image.width, height: image.height };
  } finally { blob.close?.(); }
}
