import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { requireNativeModule } from "expo";
import { fetch as nativeFetch } from "expo/fetch";
import * as WebBrowser from "expo-web-browser";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions, db } from "../firebase";
import { transferVideo } from "./youtubeUploadProtocol";

const api = httpsCallable(cloudFunctions, "youtubeUpload");
const access = httpsCallable(cloudFunctions, "getYoutubeUploadAccess");
const storageKey = (owner, kind) => "youtubeUpload:" + JSON.stringify([owner.uid, kind === "connection" ? null : owner.teamId, kind]);

function account(owner) {
  if (!owner.uid || auth.currentUser?.uid !== owner.uid) throw new Error("ログイン状態が変わりました。");
}

export async function canUpload(owner) {
  account(owner);
  const result = await access({ expectedUid: owner.uid, teamId: owner.teamId });
  account(owner);
  return result.data?.allowed === true;
}

async function call(owner, action, fields) {
  account(owner);
  const result = await api({ ...fields, expectedUid: owner.uid, teamId: owner.teamId, action });
  account(owner);
  return result.data;
}

export async function loadUpload(owner, kind) {
  const value = await AsyncStorage.getItem(storageKey(owner, kind));
  const stored = value ? JSON.parse(value) : null;
  if (kind === "connection" && owner.teamId && stored?.teamId !== owner.teamId) return null;
  return stored;
}

export async function storeUpload(owner, kind, value) {
  const key = storageKey(owner, kind);
  if (value === null) return AsyncStorage.removeItem(key);
  return AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function connectYoutube(owner, check, requiredChannelId) {
  const scheme = Constants.expoConfig?.scheme;
  const begin = await call(owner, "authorize", { scheme });
  check();
  const redirect = scheme + "://youtube-oauth";
  const result = await WebBrowser.openAuthSessionAsync(begin.url, redirect);
  check();
  if (result.type !== "success") return null;
  const callback = new URL(result.url);
  if (callback.protocol !== scheme + ":" || callback.hostname !== "youtube-oauth" ||
      callback.searchParams.get("state") !== begin.state || !callback.searchParams.get("code")) {
    throw new Error("Google連携が完了しませんでした。");
  }
  const grant = await call(owner, "connect", { flow: begin.flow, state: begin.state, code: callback.searchParams.get("code"),
    requiredChannelId: requiredChannelId || null });
  // Channel display metadata is fetched from Google on the next visit.
  await storeUpload(owner, "connection", { teamId: owner.teamId, connection: grant.connection });
  return grant;
}

export async function describeConnection(owner, saved) {
  const channel = await call(owner, "channel", { connection: saved.connection });
  return { ...saved, ...channel };
}

export async function disconnectYoutube(owner, grant) {
  await call(owner, "disconnect", { connection: grant.connection });
  await storeUpload(owner, "job", null);
  await storeUpload(owner, "connection", null);
}

// Expo SDK 54 already includes this native module (also used by expo-file-system).
// Seek a single file handle instead of loading a full camera video into JS memory.
function localFile(uri) {
  if (!uri?.startsWith("file://")) throw new Error("端末にダウンロード済みの動画を選択してください。");
  const { FileSystemFile } = requireNativeModule("FileSystem");
  return new FileSystemFile(uri);
}

export function inspectVideo(asset) {
  const file = localFile(asset.uri);
  const size = file.size;
  if (!file.exists || !size || size > 1024 ** 3 || !asset.duration || asset.duration > 900000) {
    throw new Error("長さを確認できる15分以内・1 GiB以下の動画を選んでください。");
  }
  const mime = asset.mimeType || (/\.mov$/i.test(asset.uri) ? "video/quicktime" : "video/mp4");
  return { uri: asset.uri, name: asset.fileName || "選択した動画", mime, size, modified: file.modificationTime };
}

export async function startUpload(owner, grant, source, metadata, draft) {
  const { session } = await call(owner, "start", { connection: grant.connection, channelId: grant.channelId,
    ...metadata, mime: source.mime, size: source.size });
  const projectId = doc(collection(db, "teams", owner.teamId, "projects")).id;
  const job = { source, session, channelId: grant.channelId, draft, projectId,
    title: metadata.title, privacy: metadata.privacy };
  await storeUpload(owner, "job", job);
  return job;
}

export async function sendUpload(owner, grant, job, signal, progress, check) {
  let permit;
  let refreshAt = 0;
  let checkAt = 0;
  let handle;
  try {
    const id = await transferVideo({
      size: job.source.size, mime: job.source.mime, progress,
      async check() {
        check();
        if (signal.aborted) throw new Error("送信を一時停止しました。");
        if (Date.now() >= refreshAt) {
          permit = await call(owner, "resume", { connection: grant.connection, session: job.session });
          refreshAt = Date.now() + Math.max(1, Number(permit.expiresIn || 300) - 60) * 1000;
          checkAt = Date.now() + 30000;
        } else if (Date.now() >= checkAt) {
          if (!await canUpload(owner)) throw new Error("投稿権限を確認できません。");
          checkAt = Date.now() + 30000;
        }
        check();
        if (signal.aborted) throw new Error("送信を一時停止しました。");
      },
      read(offset, length) {
        if (!handle) {
          const file = localFile(job.source.uri);
          if (!file.exists || file.size !== job.source.size || file.modificationTime !== job.source.modified) {
            throw new Error("元の動画が端末にありません。YouTube Studioで投稿状況を確認してください。");
          }
          handle = file.open();
        }
        handle.offset = offset;
        return handle.readBytes(length);
      },
      put: (headers, body) => nativeFetch(permit.location, { method: "PUT", redirect: "manual",
        headers: { ...headers, Authorization: "Bearer " + permit.accessToken }, body, signal }),
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    });
    const done = { ...job, videoId: id, source: null, session: null };
    await storeUpload(owner, "job", done);
    return done;
  } finally {
    handle?.close();
  }
}

export function checkVideo(owner, grant, videoId) {
  return call(owner, "status", { connection: grant.connection, videoId });
}

export async function saveUploadedProject(owner, project) {
  account(owner);
  const job = await loadUpload(owner, "job");
  if (job) {
    if (job.projectId !== project.id || !job.videoId ||
        project.videoUrl !== "https://www.youtube.com/watch?v=" + job.videoId) {
      throw new Error("端末の投稿記録と登録先が一致しません。");
    }
    const { title, type, participants, tagGroupId } = project;
    await storeUpload(owner, "job", { ...job, draft: { title, type, participants, tagGroupId } });
  }
  if (!await canUpload(owner)) throw new Error("投稿権限を確認できません。");
  const ref = doc(db, "teams", owner.teamId, "projects", project.id);
  await runTransaction(db, async tx => {
    account(owner);
    const existing = await tx.get(ref);
    if (existing.exists()) {
      if (existing.data().createdBy !== owner.uid || existing.data().videoUrl !== project.videoUrl) {
        throw new Error("この登録先には別の動画があります。");
      }
      return;
    }
    tx.set(ref, { ...project, teamId: owner.teamId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
  await storeUpload(owner, "job", null);
}
