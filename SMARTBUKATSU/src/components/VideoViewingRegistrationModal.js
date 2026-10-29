import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Modal, ScrollView,
  KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import {
  listVideoViewingProjects, createVideoViewingProject, addVideosToViewingProject,
} from "../services/videoViewingService";
import { viewingPermissions, hasViewingTags, ownPrivateTagCount } from "../utils/videoViewingGuidance";

export function ViewingProjectPicker({ projects, onSelect, onClose }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.heading}>開く閲覧用プロジェクトを選択</Text>
          <ScrollView style={styles.scroll}>
            {projects.map((project) => (
              <TouchableOpacity key={project.id} accessibilityRole="button" style={styles.option} onPress={() => onSelect(project)}>
                <Text style={styles.link}>{project.title || "名称未設定"}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity accessibilityRole="button" style={styles.cancel} onPress={onClose}><Text>キャンセル</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function VideoViewingRegistrationModal({ teamId, videos, viewer, onCompleted, onClose,
  initialPrompt = false, onBeforeRegister }) {
  const { canCreate, canAdd } = viewingPermissions(viewer.userRole, viewer.canUploadVideos);
  const candidates = videos.filter((video) => hasViewingTags(video, viewer));
  const [selectedIds, setSelectedIds] = useState(() => candidates.map((video) => video.id));
  const [mode, setMode] = useState(canCreate ? "new" : "existing");
  const [title, setTitle] = useState(candidates.length === 1 ? candidates[0].title || "" : "");
  const [destinations, setDestinations] = useState([]);
  const [destinationId, setDestinationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [promptActive, setPromptActive] = useState(initialPrompt);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (promptActive || mode !== "existing" || !canAdd) return undefined;
    let current = true;
    setLoading(true); setLoadError(""); setDestinationId("");
    listVideoViewingProjects(teamId).then((items) => {
      if (current) { setDestinations(items); setLoading(false); }
    }, () => {
      if (current) { setLoadError("追加先を確認できません。通信状態を確認して再試行してください。"); setLoading(false); }
    });
    return () => { current = false; };
  }, [teamId, mode, canAdd, attempt, promptActive]);
  const selectedVideos = candidates.filter((video) => selectedIds.includes(video.id));
  const privateCount = ownPrivateTagCount(selectedVideos, viewer);
  const canPublish = ["owner", "admin", "staff", "captain"].includes(viewer.userRole) ||
    (["member", "guardian"].includes(viewer.userRole) && Boolean(viewer.canEditTags));
  const close = () => { if (!savingRef.current && !startingRef.current) onClose(); };
  const beginRegistration = async () => {
    if (startingRef.current || !(canCreate || canAdd)) return;
    startingRef.current = true; setStarting(true); setSaveError("");
    try {
      const allowed = onBeforeRegister ? await onBeforeRegister() : true;
      if (mounted.current && allowed !== false) setPromptActive(false);
    } catch {
      if (mounted.current) setSaveError("準備できませんでした。通信状態を確認して再試行してください。");
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
  };
  const save = async () => {
    if (savingRef.current) return;
    if ((mode === "new" && !canCreate) || (mode === "existing" && !canAdd)) return;
    if (!selectedVideos.length) { setSaveError("動画を1件以上選択してください。"); return; }
    if (mode === "new" && !title.trim()) { setSaveError("プロジェクト名を入力してください。"); return; }
    if (mode === "existing" && (!destinationId || loading || loadError)) {
      setSaveError("追加先を選択してください。"); return;
    }
    savingRef.current = true; setSaving(true); setSaveError("");
    try {
      const ids = selectedVideos.map((video) => video.id);
      const project = mode === "new"
        ? await createVideoViewingProject(teamId, title, ids, viewer)
        : await addVideosToViewingProject(teamId, destinationId, ids, viewer);
      if (mounted.current) onCompleted(project);
    } catch (error) {
      if (mounted.current) setSaveError(error.code
        ? error.code === "permission-denied" ? "保存する権限を確認してください。" : "保存できませんでした。通信状態を確認して再試行してください。"
        : error.message || "保存できませんでした。通信状態を確認して再試行してください。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  // Keep the same native Modal mounted when advancing to the existing form.
  if (promptActive) return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.dialog}>
          <Text style={styles.heading}>タグを公開しました</Text>
          <Text style={styles.description}>この動画を「動画閲覧」に追加して、タグ付けした場面を見返しませんか？</Text>
          <Text style={styles.description}>あとで追加する場合は、動画画面の案内からいつでも進めます。</Text>
          {!!saveError && <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text>}
          <View style={styles.footer}>
            <TouchableOpacity accessibilityRole="button" style={styles.cancel} onPress={close} disabled={starting}><Text>あとで</Text></TouchableOpacity>
            {(canCreate || canAdd) && <TouchableOpacity accessibilityRole="button" style={[styles.primary, starting && styles.disabled]} onPress={beginRegistration} disabled={starting}>
              <Text style={styles.primaryText}>{starting ? "準備中…" : "閲覧に追加する"}</Text>
            </TouchableOpacity>}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.dialog}>
          <Text style={styles.heading}>閲覧用プロジェクトに追加</Text>
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.description}>タグ付けした場面を見返すために、動画を追加します。</Text>
            {!(canCreate || canAdd) && <Text style={styles.description}>動画追加の権限を持つメンバーに依頼してください。</Text>}
            <View style={styles.modes}>
              {canCreate && <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setMode("new")} style={[styles.mode, mode === "new" && styles.selected]}><Text>新しく作る</Text></TouchableOpacity>}
              {canAdd && <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setMode("existing")} style={[styles.mode, mode === "existing" && styles.selected]}><Text>既存に追加</Text></TouchableOpacity>}
            </View>
            {mode === "new" && canCreate && <>
              <Text style={styles.label}>プロジェクト名</Text>
              <TextInput accessibilityLabel="閲覧用プロジェクト名" style={styles.input} value={title} onChangeText={setTitle} editable={!saving} placeholder="例：練習の振り返り" />
            </>}
            {mode === "existing" && canAdd && <>
              <Text style={styles.label}>追加先</Text>
              {loading ? <Text style={styles.description}>追加先を読み込み中…</Text> : loadError ? <>
                <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)}><Text style={styles.link}>追加先を再確認</Text></TouchableOpacity>
              </> : destinations.length ? destinations.map((project) => (
                <TouchableOpacity key={project.id} accessibilityRole="radio" accessibilityState={{ checked: destinationId === project.id }} disabled={saving} style={[styles.option, destinationId === project.id && styles.selected]} onPress={() => setDestinationId(project.id)}>
                  <Text>{destinationId === project.id ? "● " : "○ "}{project.title || "名称未設定"}</Text>
                </TouchableOpacity>
              )) : <Text style={styles.description}>追加先がありません。「新しく作る」を選んでください。</Text>}
            </>}
            <Text style={styles.label}>追加する動画（{selectedVideos.length}件）</Text>
            {candidates.map((video) => {
              const selected = selectedIds.includes(video.id);
              return <TouchableOpacity key={video.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} disabled={saving} style={[styles.option, selected && styles.selected]} onPress={() => setSelectedIds((ids) => selected ? ids.filter((id) => id !== video.id) : [...ids, video.id])}>
                <Text>{selected ? "☑ " : "☐ "}{video.title || "名称未設定"}</Text>
              </TouchableOpacity>;
            })}
            {privateCount > 0 && <Text style={styles.description}>自分のみのタグが{privateCount}件あります。{canPublish ? "チームにも見せる場合は、元動画の「自分のみのタグを一括公開」から公開してください。" : "チームへの公開にはタグ編集の権限が必要です。"}ここで追加しても自動公開されません。</Text>}
            {!!saveError && <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text>}
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity accessibilityRole="button" style={styles.cancel} onPress={close} disabled={saving}><Text>キャンセル</Text></TouchableOpacity>
            {(canCreate || canAdd) && <TouchableOpacity accessibilityRole="button" style={[styles.primary, saving && styles.disabled]} onPress={save} disabled={saving || (mode === "existing" && (loading || Boolean(loadError)))}><Text style={styles.primaryText}>{saving ? "保存中…" : "追加して閲覧を開く"}</Text></TouchableOpacity>}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.5)" },
  dialog: { backgroundColor: "#fff", borderRadius: 16, padding: 18, maxHeight: "90%", width: "100%", maxWidth: 600, alignSelf: "center" },
  heading: { fontSize: 18, fontWeight: "bold", color: "#333", marginBottom: 12 },
  scroll: { flexGrow: 0 },
  description: { fontSize: 13, color: "#555", lineHeight: 20, marginVertical: 8 },
  label: { fontWeight: "bold", marginTop: 14, marginBottom: 6, color: "#333" },
  modes: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 6 },
  mode: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12 },
  selected: { backgroundColor: "#eaf5ff", borderColor: "#0077cc" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, color: "#333" },
  option: { padding: 12, marginVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: "#ddd" },
  link: { color: "#0077cc", fontWeight: "bold", paddingVertical: 8 },
  error: { color: "#b42318", fontSize: 13, marginVertical: 8 },
  footer: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, paddingTop: 12 },
  cancel: { padding: 12, alignItems: "center" },
  primary: { backgroundColor: "#0077cc", padding: 12, borderRadius: 8, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "bold" },
  disabled: { opacity: 0.6 },
});
