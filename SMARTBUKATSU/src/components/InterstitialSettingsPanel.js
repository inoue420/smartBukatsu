import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { useAds } from "../ads/AdManager";
import { DEFAULT_POLICY } from "../ads/interstitialPolicy";

const choices = [["off", "表示停止"], ["debug", "SharpRiseデバッグ部所属者のみ"], ["all", "全員"]];
export default function InterstitialSettingsPanel() {
  const { interstitialSettings, refreshInterstitialSettings, saveGlobalInterstitialSettings } = useAds();
  const [draft, setDraft] = useState(DEFAULT_POLICY);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(true), saving = useRef(false);
  const refresh = async () => {
    setBusy(true); setReady(false); setMessage("");
    const ok = await refreshInterstitialSettings();
    if (!alive.current) return;
    setReady(ok); setBusy(false);
    if (!ok) setMessage("設定を取得できませんでした。通信状態を確認して再読み込みしてください。");
  };
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (interstitialSettings) setDraft({ audience: interstitialSettings.audience,
      minimumUsageMinutes: interstitialSettings.minimumUsageMinutes });
  }, [interstitialSettings]);
  const save = async () => {
    if (saving.current || !ready || busy) return;
    saving.current = true; setBusy(true); setMessage("");
    try {
      await saveGlobalInterstitialSettings(draft);
      if (alive.current) setMessage("保存しました。他の端末には次の設定取得時に反映されます。");
    } catch {
      if (alive.current) setMessage("保存結果を確認できませんでした。所属・通信状態を確認し、再読み込みしてください。");
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  return <View style={styles.panel}>
    <Text style={styles.title}>インタースティシャル広告（全体設定）</Text>
    <Text>全利用者に適用する設定です。端末ごとに1日1回まで、作業の区切りで表示します。表示停止でもバナー広告は継続します。</Text>
    {choices.map(([value, label]) => <TouchableOpacity key={value} accessibilityRole="radio"
      accessibilityState={{ checked: draft.audience === value, disabled: busy || !ready }}
      disabled={busy || !ready} onPress={() => setDraft(old => ({ ...old, audience: value }))} style={styles.option}>
      <Text>{draft.audience === value ? "●" : "○"} {label}</Text>
    </TouchableOpacity>)}
    <Text>必要な当日の累積利用時間：{draft.minimumUsageMinutes}分</Text>
    <View style={styles.row}>
      {[[-1, "1分減らす"], [1, "1分増やす"]].map(([delta, label]) => <TouchableOpacity key={label}
        accessibilityRole="button" accessibilityLabel={label}
        disabled={busy || !ready || draft.minimumUsageMinutes + delta < 1 || draft.minimumUsageMinutes + delta > 30}
        onPress={() => setDraft(old => ({ ...old, minimumUsageMinutes: old.minimumUsageMinutes + delta }))} style={styles.option}>
        <Text>{delta < 0 ? "−" : "＋"}</Text>
      </TouchableOpacity>)}
    </View>
    <TouchableOpacity accessibilityRole="button" disabled={busy || !ready} onPress={save} style={styles.option}>
      <Text>広告設定を保存</Text>
    </TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={refresh} style={styles.option}>
      <Text>設定を再読み込み</Text>
    </TouchableOpacity>
    {busy && <ActivityIndicator />}
    {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: 16, marginVertical: 12, backgroundColor: "#fff", borderRadius: 12, gap: 10 },
  title: { fontWeight: "bold", fontSize: 16 },
  option: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 12 },
  row: { flexDirection: "row", gap: 12 },
});
