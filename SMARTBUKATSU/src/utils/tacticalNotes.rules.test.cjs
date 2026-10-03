// Run against the local emulator started with --project_id demo-tactical-notes --port 8189.
// No production credentials or production endpoints are used.
const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, getDocs,
  collection, deleteDoc, serverTimestamp, terminate } = require("firebase/firestore");
const projectId = "demo-tactical-notes";
const port = 8189;

test("Firestore enforces note roles, authorship, team isolation and staff-controlled posting", async () => {
  const rules = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../firestore.rules"), "utf8");
  const loaded = await fetch(`http://127.0.0.1:${port}/emulator/v1/projects/${projectId}:securityRules`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: rules }] } }),
  });
  assert.equal(loaded.ok, true, await loaded.text());
  const apps = [], databases = [];
  const client = (uid, admin = false) => {
    const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `${uid}-${Date.now()}`);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, "127.0.0.1", port, { mockUserToken: admin ? "owner" : { sub: uid } });
    apps.push(app); databases.push(db); return db;
  };
  const denied = async (operation) => assert.rejects(operation, (error) => error.code === "permission-denied");
  const team = `test-${Date.now()}`;
  const note = (db, id) => doc(db, "teams", team, "tacticalNotes", id);
  const member = (db, uid) => doc(db, "teams", team, "members", uid);
  const payload = (uid) => ({ title: "指導", description: "説明", assigneeUids: ["member"],
    clips: [{ projectId: "video", tagId: "tag", projectTitle: "試合", label: "得点", start: 1, end: 4, comment: "確認" }],
    sourceProjectId: "source", authorUid: uid, authorName: "テスト投稿者",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  try {
    const admin = client("seed", true);
    await setDoc(doc(admin, "teams", team), { createdBy: "owner" });
    for (const role of ["owner", "admin", "staff", "captain", "member", "guardian"]) {
      await setDoc(member(admin, role), { role });
    }
    const staff = client("staff"), captain = client("captain"), player = client("member"), guardian = client("guardian"), outsider = client("outsider"), owner = client("owner");
    await setDoc(note(captain, "captain-note"), payload("captain"));
    await setDoc(note(staff, "staff-note"), payload("staff"));
    await getDoc(note(player, "captain-note"));
    await getDocs(collection(player, "teams", team, "tacticalNotes"));
    await denied(getDoc(note(guardian, "captain-note")));
    await denied(getDocs(collection(guardian, "teams", team, "tacticalNotes")));
    await setDoc(doc(admin, "users", "outsider"), { activeTeamId: team });
    await denied(getDoc(note(outsider, "captain-note")));
    await denied(setDoc(note(guardian, "guardian-note"), payload("guardian")));
    await denied(setDoc(note(player, "member-note"), payload("member")));
    await denied(updateDoc(member(player, "member"), { canPostTacticalNotes: true }));
    await denied(updateDoc(member(guardian, "guardian"), { role: "member" }));
    await updateDoc(member(player, "member"), { name: "プロフィール更新" });
    await updateDoc(member(staff, "member"), { canPostTacticalNotes: true });
    await setDoc(note(player, "member-note"), payload("member"));
    await updateDoc(member(staff, "member"), { canPostTacticalNotes: false });
    await denied(setDoc(note(player, "member-note-2"), payload("member")));
    await updateDoc(note(player, "member-note"), { description: "自分の投稿を編集", updatedAt: serverTimestamp() });
    await denied(updateDoc(note(staff, "member-note"), { description: "他人の投稿を編集", updatedAt: serverTimestamp() }));
    await denied(updateDoc(note(player, "member-note"), { authorUid: "staff", updatedAt: serverTimestamp() }));
    await denied(setDoc(note(captain, "spoof"), payload("owner")));
    await updateDoc(note(owner, "member-note"), { title: "管理者の編集", updatedAt: serverTimestamp() });
    await denied(deleteDoc(note(guardian, "member-note")));
    await deleteDoc(note(player, "member-note"));
    await deleteDoc(note(owner, "captain-note"));
    // Preserve the existing team creator's explicit supervisor recovery path.
    await updateDoc(member(admin, "owner"), { role: "guardian" });
    await updateDoc(member(owner, "owner"), { role: "admin" });
    assert.equal((await getDoc(member(owner, "owner"))).data().role, "admin");
  } finally {
    await Promise.all(databases.map(terminate));
    await Promise.all(apps.map(deleteApp));
  }
});
