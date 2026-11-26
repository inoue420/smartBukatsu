import React, { useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ResizeMode, Video } from "expo-av";
import { checkVideo, connectYoutube, describeConnection, disconnectYoutube, inspectVideo, loadUpload, sendUpload,
  startUpload, storeUpload } from "../services/youtubeUploadService";

const activeOperations = new Set();
const missingTitleMessage = "動画名を入力してください。";
const privacyLabels = { unlisted: "限定公開", public: "公開", private: "非公開" };
const phases = { processing: "YouTubeで処理中", uploaded: "YouTubeで処理中", succeeded: "YouTubeの処理が完了",
  processed: "YouTubeの処理が完了", failed: "YouTubeの処理に失敗", rejected: "YouTubeが投稿を拒否",
  terminated: "YouTubeの処理が停止", deleted: "削除済み", unavailable: "削除またはアクセス制限" };

function Button({ title, onPress, disabled, selected }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!selected }}
    onPress={onPress} disabled={disabled} style={[s.button, selected && s.selected, disabled && s.disabled]}>
    <Text style={selected ? s.selectedText : s.buttonText}>{title}</Text>
  </TouchableOpacity>;
}

// Unlinking remains available to the original uploader after a role or team change.
export function YoutubeConnectionControl({ uid }) {
  const [grant, setGrant] = useState(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let current = true;
    if (uid) loadUpload({ uid }, "connection").then(value => { if (current) setGrant(value); }).catch(() => {});
    return () => { current = false; };
  }, [uid]);
  if (!grant) return null;
  return <Button title="YouTube連携を解除" disabled={working} onPress={() =>
    Alert.alert("Google連携を解除しますか？", "端末の投稿記録と再開情報を削除します。YouTube上の動画は引き続きご自身が管理します。",
      [{ text: "戻る", style: "cancel" }, { text: "解除する", onPress: async () => {
        setWorking(true);
        try { await disconnectYoutube({ uid, teamId: grant.teamId }, grant); setGrant(null); }
        catch { Alert.alert("連携解除を確認できません", "通信環境を確認して再試行してください。"); }
        finally { setWorking(false); }
      } }])} />;
}

export default function YoutubeUploadPanel({ owner, draft, onRestoreDraft, onResult, onBusy, onClear }) {
  const key = JSON.stringify([owner.uid, owner.teamId]);
  const live = useRef(false);
  const abort = useRef(null);
  const callbacks = useRef({});
  callbacks.current = { onResult, onBusy, onClear, onRestoreDraft };
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState(null);
  const [job, setJob] = useState(null);
  const [source, setSource] = useState(null);
  const title = draft.title?.trim() ?? "";
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("unlisted");
  const [kids, setKids] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    live.current = true;
    let current = true;
    Promise.all([loadUpload(owner, "connection"), loadUpload(owner, "job")]).then(([connection, saved]) => {
      if (!current) return;
      setGrant(connection);
      setJob(saved);
      setExpanded(!!saved);
      if (saved?.draft && !saved.videoId) callbacks.current.onRestoreDraft(saved.draft);
      if (saved?.videoId) callbacks.current.onResult(saved, true);
      setReady(true);
    }).catch(() => { if (current) setMessage("端末の再開情報を確認できません。画面を開き直してください。"); });
    const subscription = AppState.addEventListener("change", state => {
      if (state === "background") abort.current?.abort();
    });
    return () => { current = false; live.current = false; abort.current?.abort(); subscription.remove(); };
  }, [key]);
  useEffect(() => {
    if (!expanded || !grant || grant.channelId) return undefined;
    let current = true;
    describeConnection(owner, grant).then(info => { if (current) setGrant(info); })
      .catch(() => { if (current) setMessage("Googleとの連携を確認できません。通信環境を確認し、必要に応じて再連携してください。"); });
    return () => { current = false; };
  }, [key, expanded, grant]);

  function check() {
    if (!live.current) throw new Error("利用画面が変わりました。");
  }
  async function run(task) {
    if (!live.current) return;
    if (activeOperations.has(key)) { setMessage("前の操作の終了後にもう一度お試しください。"); return; }
    activeOperations.add(key);
    setBusy(true);
    callbacks.current.onBusy(true);
    setMessage("");
    try { await task(); }
    catch (error) {
      if (live.current) {
        if (error.details?.reconnect && grant) setGrant({ connection: grant.connection });
        setMessage(error.message || "操作に失敗しました。");
      }
    }
    finally {
      activeOperations.delete(key);
      if (live.current) { setBusy(false); callbacks.current.onBusy(false); setProgress(null); }
    }
  }
  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: false,
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough });
    check();
    if (result.canceled) return;
    setSource(inspectVideo(result.assets[0]));
    setAccepted(false);
    setReview(false);
    setKids(null);
    setPrivacy("unlisted");
    setDescription("");
  }
  async function status(saved) {
    const result = await checkVideo(owner, grant, saved.videoId);
    check();
    setMessage((phases[result.phase] || "YouTubeでの処理状況は未確認") +
      (result.privacy ? "（" + (privacyLabels[result.privacy] || result.privacy) + "）" : ""));
  }
  async function upload(publicConfirmed) {
    const previous = await loadUpload(owner, "job");
    check();
    if (previous?.projectId !== job?.projectId) {
      setJob(previous);
      throw new Error("端末の投稿記録が変わりました。内容を確認してから続けてください。");
    }
    if (previous && previous.channelId !== grant.channelId) throw new Error("元の投稿チャンネルに連携し直してください。");
    if (!previous && !title) throw new Error(missingTitleMessage);
    const saved = previous || await startUpload(owner, grant, source,
      { title, description, privacy, kids, accepted, publicConfirmed }, draft);
    check();
    setJob(saved);
    if (saved.videoId) { callbacks.current.onResult(saved, false); return; }
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    try {
      const done = await sendUpload(owner, grant, saved, controller.signal,
        ratio => { if (live.current) setProgress(Math.floor(ratio * 100)); }, check);
      check();
      setJob(done);
      callbacks.current.onResult(done, false);
      await status(done);
    } finally { abort.current = null; }
  }
  function discard() {
    Alert.alert("端末の投稿記録を閉じますか？", "送信結果が不明な場合は先にYouTube Studioを確認してください。投稿済みの動画はYouTubeに残ります。",
      [{ text: "戻る", style: "cancel" }, { text: "確認して閉じる", onPress: () => run(async () => {
        await storeUpload(owner, "job", null); check(); setJob(null); setSource(null); setAccepted(false); setReview(false);
        callbacks.current.onClear();
      }) }]);
  }
  if (!ready) return message ? <Text>{message}</Text> : null;
  return <View style={s.panel}>
    {!expanded ? <Button title="YouTubeへアップロード" onPress={() => setExpanded(true)} /> : <>
      <Text style={s.heading}>YouTubeへアップロード</Text>
      {grant?.title && <Text>投稿先　{grant.title}</Text>}
      {!grant?.channelId && <Button title={grant ? "チャンネルに再連携" : "自分のYouTubeチャンネルを連携"} disabled={busy} onPress={() => run(async () => {
        const connected = await connectYoutube(owner, check, job?.channelId); check(); if (connected) setGrant(connected);
      })} />}
      {grant?.channelId && !job && <>
        {!review && <Button title={source ? "動画を選び直す" : "端末の動画を選ぶ"} disabled={busy} onPress={() => run(pick)} />}
        {source && <>
          <Text>{source.name}（{Math.ceil(source.size / 1048576)} MiB）</Text>
          <Video source={{ uri: source.uri }} useNativeControls shouldPlay={false} resizeMode={ResizeMode.CONTAIN}
            style={{ width: "100%", height: 180 }} />
          {!title && <Text accessibilityLiveRegion="polite">{missingTitleMessage}</Text>}
          {!review ? <>
          <Text>説明</Text>
          <TextInput accessibilityLabel="YouTube動画の説明" style={s.input} value={description} onChangeText={setDescription} editable={!busy} multiline />
          <Text>公開範囲</Text>
          <View style={s.row}>{Object.entries(privacyLabels).map(([value, label]) =>
            <Button key={value} title={label} selected={privacy === value} disabled={busy} onPress={() => setPrivacy(value)} />)}</View>
          <Text>{privacy === "unlisted" ? "リンクを知る人は視聴・再共有できます。" : privacy === "private" ?
            "YouTubeで許可された人のみ視聴でき、チーム内でも再生できない場合があります。" : "誰でも検索・視聴・再共有できます。"}</Text>
          <Text>この動画は子どもを主な視聴者として制作しましたか？</Text>
          <View style={s.row}>{[true, false].map(value => <Button key={String(value)} title={value ? "はい" : "いいえ"}
            selected={kids === value} disabled={busy} onPress={() => setKids(value)} />)}</View>
          <Button title={accepted ? "確認済み：撮影・掲載の許可" : "撮影・掲載の許可を確認"} selected={accepted}
            disabled={busy} onPress={() => setAccepted(!accepted)} />
          <Button title="投稿内容を確認" disabled={busy || !title || kids === null || !accepted} onPress={() => setReview(true)} />
          </> : <>
          <Text style={s.heading}>{privacy === "public" ? "全世界に公開しますか？" : "YouTubeへの投稿確認"}</Text>
          <Text>{title}</Text>
          {!!description && <Text>{description}</Text>}
          <Text>{privacyLabels[privacy]} · {kids ? "子ども向け" : "子ども向けではない"}</Text>
          {privacy === "public" && <Text>誰でも検索・視聴・再共有できます。</Text>}
          <Text>投稿すると、コンテンツがYouTube利用規約（コミュニティ ガイドラインを含む）に準拠していることを表明します。他者の著作権・プライバシーを侵害しないでください。</Text>
          <Text accessibilityRole="link" style={s.link} onPress={() => Linking.openURL("https://m.youtube.com/terms")}>YouTube利用規約</Text>
          <Button title={privacy === "public" ? "公開で投稿する" : "この内容で投稿する"} disabled={busy || !title}
            onPress={() => run(() => upload(privacy === "public"))} />
          <Button title="編集に戻る" disabled={busy} onPress={() => setReview(false)} />
          </>}
        </>}
      </>}
      {job && <><Text>{job.title} · {privacyLabels[job.privacy]}</Text>
        <Text>{job.videoId ? "YouTube投稿済み。アプリへの登録は下の作成ボタンで確定します。" : "再開できる投稿があります。"}</Text>
        {job.videoId ? <>
          <Button title="取得済みURLを入力欄に反映" disabled={busy} onPress={() => callbacks.current.onResult(job, false)} />
          {grant?.channelId && <Button title="YouTubeの処理状況を確認" disabled={busy} onPress={() => run(() => status(job))} />}
        </> : grant?.channelId && <Button title="同じ投稿を再開" disabled={busy} onPress={() => run(() => upload(false))} />}
        <Button title="端末の投稿記録を閉じる" disabled={busy} onPress={discard} />
      </>}
      {grant && <Button title="Google連携を解除" disabled={busy} onPress={() => Alert.alert("Google連携を解除しますか？",
        "端末の再開情報と投稿記録を削除します。YouTube上の動画を削除する場合はYouTubeで操作してください。",
        [{ text: "戻る", style: "cancel" }, { text: "連携を解除", onPress: () => run(async () => {
          await disconnectYoutube(owner, grant); check(); setGrant(null); setJob(null); setSource(null); setReview(false); callbacks.current.onClear();
        }) }])} />}
      {progress !== null && <><Text>送信中　{progress}%</Text><Button title="一時停止" onPress={() => abort.current?.abort()} /></>}
    </>}
    {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
  </View>;
}

const s = StyleSheet.create({
  panel: { gap: 8, paddingVertical: 8 },
  heading: { fontSize: 16, fontWeight: "bold" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  button: { alignSelf: "flex-start", borderColor: "#17669a", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6 },
  selected: { backgroundColor: "#17669a" }, selectedText: { color: "#fff" }, buttonText: { color: "#135581" },
  disabled: { opacity: 0.5 }, input: { backgroundColor: "#fff", padding: 8, borderWidth: 1, borderColor: "#777", borderRadius: 5 },
  link: { color: "#135581", textDecorationLine: "underline" },
});
