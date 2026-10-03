const test = require("node:test"), assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, serverTimestamp, terminate, writeBatch } = require("firebase/firestore");
const fs = require("node:fs"), vm = require("node:vm"), { parse } = require("@babel/parser");
const { noteAcknowledgementId, hasNoteAcknowledgement, isNoteSummaryCurrent } = require("./tacticalNotes");
const firestore = require("firebase/firestore");
const serviceSource = fs.readFileSync(require("node:path").join(__dirname, "../services/firestoreService.js"), "utf8");
const responseFunction = parse(serviceSource, { sourceType: "module" }).program.body
  .find((node) => node.declaration?.id?.name === "recordTacticalNoteResponse").declaration;
// Keep payload objects in the SDK's realm; Firebase rejects objects from a separate VM realm.
const responseService = (db, uid) => vm.runInThisContext(`({ db, auth, doc, collection, setDoc, serverTimestamp,
  getDocs, query, where, limit, runTransaction, noteAcknowledgementId, hasNoteAcknowledgement, isNoteSummaryCurrent }) =>
  (${serviceSource.slice(responseFunction.start, responseFunction.end)})`)(
  { ...firestore, db, auth: { currentUser: { uid } }, noteAcknowledgementId, hasNoteAcknowledgement, isNoteSummaryCurrent });
test("Phase 2 rules enforce identity, confirmation versions, individual progress, replies and reasoned return", async () => {
  const port = 8189, projectId = "demo-tactical-notes";
  const loaded = await fetch(`http://127.0.0.1:${port}/emulator/v1/projects/${projectId}:securityRules`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: require("node:fs").readFileSync("firestore.rules", "utf8") }] } }),
  });
  assert.equal(loaded.ok, true, await loaded.text());
  const apps = [], databases = [];
  const client = (uid, admin = false) => {
    const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `phase2-${uid}-${Date.now()}`);
    const db = getFirestore(app); connectFirestoreEmulator(db, "127.0.0.1", port, { mockUserToken: admin ? "owner" : { sub: uid } }); apps.push(app); databases.push(db); return db;
  };
  const denied = (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
  const team = `phase2-${Date.now()}`, parent = (db) => doc(db, "teams", team, "tacticalNotes", "note");
  const child = (db, collection, id) => doc(parent(db), collection, id);
  try {
    const seed = client("seed", true), author = client("author"), a = client("a"), b = client("b"), guardian = client("guardian"), staff = client("staff"), outsider = client("outsider");
    for (const [uid, role] of [["author", "captain"], ["a", "member"], ["b", "member"], ["guardian", "guardian"], ["staff", "staff"]]) await setDoc(doc(seed, "teams", team, "members", uid), { role });
    const task = { text: "練習", assigneeUids: ["a", "b"], dueDate: "2026-10-03", clipKey: "", revision: 1 };
    await setDoc(parent(author), { title: "指導", description: "説明", clips: [], images: [{ id: "image" }], tasks: { task }, assigneeUids: ["a", "b"], contentVersion: 1, draft: false, sourceProjectId: "", authorUid: "author", authorName: "投稿者", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    const syncIndex = async () => {
      const current = (await getDoc(parent(seed))).data();
      await setDoc(doc(seed, "teams", team, "tacticalNoteSummaries", "note"), { schemaVersion: 1, contentVersion: current.contentVersion, noteUpdatedAt: current.updatedAt });
    };
    await syncIndex();
    await denied(setDoc(doc(a, "teams", team, "tacticalNoteSummaries", "note"), {contentVersion: 999}));
    const response = { uid: "a", version: 1, status: "question", text: "質問", createdAt: serverTimestamp() };
    await setDoc(child(a, "responses", "question"), response);
    await denied(setDoc(child(b, "responses", "spoof"), response));
    await denied(setDoc(child(guardian, "responses", "guardian"), { ...response, uid: "guardian" }));
    await denied(getDoc(child(outsider, "responses", "question")));
    await denied(updateDoc(child(a, "responses", "question"), { text: "改ざん" }));
    await updateDoc(parent(author), { description: "旧アプリからの変更", updatedAt: serverTimestamp() });
    await denied(setDoc(child(a, "responses", "index-stale"), response));
    await updateDoc(parent(author), { description: "変更", contentVersion: 2, updatedAt: serverTimestamp() });
    await syncIndex();
    await denied(setDoc(child(a, "responses", "stale"), response));
    await setDoc(child(a, "responses", "fresh"), { ...response, version: 2 });
    // Use the actual client save function against rules, including another device for the same person.
    const viewed = { ...(await getDoc(parent(a))).data(), id: "note" };
    const saveA = responseService(a, "a"), saveB = responseService(b, "b");
    const secondDevice = responseService(client("a"), "a");
    await Promise.all([saveA(team, viewed, "read"), secondDevice(team, viewed, "read")]);
    await saveA(team, viewed, "read");
    await saveA(team, viewed, "understood");
    await saveA(team, viewed, "understood");
    const ownResponses = async (db, uid) => (await firestore.getDocs(firestore.query(firestore.collection(parent(db), "responses"), firestore.where("uid", "==", uid)))).docs;
    let records = await ownResponses(a, "a");
    for (const status of ["read", "understood"]) {
      const matches = records.filter((item) => item.data().version === 2 && item.data().status === status);
      assert.equal(matches.length, 1); assert.equal(matches[0].id, noteAcknowledgementId(viewed, "a", status));
    }
    await setDoc(child(b, "responses", "legacy-auto-id"), { uid: "b", version: 2, status: "read", text: "", createdAt: serverTimestamp() });
    await saveB(team, viewed, "read");
    assert.equal((await ownResponses(b, "b")).length, 1);
    assert.equal((await getDoc(child(b, "responses", noteAcknowledgementId(viewed, "b", "read")))).exists(), false);
    await saveA(team, viewed, "question", "追加の質問");
    await saveA(team, viewed, "question", "追加の質問");
    assert.equal((await ownResponses(a, "a")).filter((item) => item.data().text === "追加の質問").length, 2);
    await updateDoc(parent(author), { description: "再確認する内容", contentVersion: 3, updatedAt: serverTimestamp() });
    await syncIndex();
    await assert.rejects(saveB(team, viewed, "understood"), /変更/);
    const revised = { ...viewed, contentVersion: 3 };
    await saveA(team, revised, "read"); await saveA(team, revised, "understood");
    records = await ownResponses(a, "a");
    for (const version of [2, 3]) for (const status of ["read", "understood"]) {
      assert.equal(records.filter((item) => item.data().version === version && item.data().status === status).length, 1);
    }
    await denied(updateDoc(child(b, "responses", "question"), {resolved: true, resolvedAt: serverTimestamp(), resolvedBy: "b"}));
    await denied(updateDoc(child(author, "responses", "question"), {resolved: true, resolvedAt: serverTimestamp(), resolvedBy: "author"}));
    await updateDoc(child(a, "responses", "question"), {resolved: true, resolvedAt: serverTimestamp(), resolvedBy: "a"});
    await denied(updateDoc(child(a, "responses", "question"), {resolved: false}));
    const registration = {uploaderUid: "author", storagePath: `tacticalNoteAttachments/${team}/note/image.jpg`, size: 100, createdAt: serverTimestamp()};
    await setDoc(child(author, "attachmentUploads", "image"), registration);
    await denied(setDoc(child(a, "attachmentUploads", "foreign"), {...registration, uploaderUid: "a"}));
    await denied(updateDoc(child(author, "attachmentUploads", "image"), {size: 200}));
    const reply = { responseId: "question", uid: "author", text: "返信", createdAt: serverTimestamp() };
    await setDoc(child(author, "replies", "reply"), reply);
    await denied(setDoc(child(staff, "replies", "foreign"), { ...reply, uid: "staff" }));
    const progress = (status, actor = "a", comment = "") => ({ taskId: "task", uid: "a", taskRevision: 1, status, comment, updatedBy: actor, updatedAt: serverTimestamp(), completedAt: status === "done" ? serverTimestamp() : null });
    const batch = writeBatch(a); batch.set(child(a, "progress", "task_a"), progress("done")); batch.set(child(a, "progressHistory", "done"), {...progress("done"), taskText: "練習"}); await batch.commit();
    assert.equal((await getDoc(child(b, "progress", "task_a"))).data().status, "done");
    await denied(setDoc(child(a, "progressHistory", "forged-text"), {...progress("done"), taskText: "偽の内容"}));
    await denied(setDoc(child(b, "progress", "task_a"), progress("done", "b")));
    await denied(setDoc(child(author, "progress", "task_a"), progress("done", "author")));
    await denied(setDoc(child(author, "progress", "task_a"), progress("returned", "author")));
    await setDoc(child(author, "progress", "task_a"), progress("returned", "author", "もう一度確認"));
    await setDoc(child(a, "progress", "task_a"), progress("pending"));
    await denied(setDoc(child(a, "progress", "wrong-id"), progress("done")));
    await updateDoc(parent(author), { tasks: { task: { ...task, revision: 2, text: "新しい練習" } }, updatedAt: serverTimestamp() });
    await denied(setDoc(child(a, "progress", "task_a"), progress("done")));
    await denied(updateDoc(child(a, "progressHistory", "done"), { comment: "履歴改ざん" }));
    await denied(setDoc(child(a, "progressHistory", "forged"), { ...progress("done"), taskRevision: 2 }));
  } finally { await Promise.all(databases.map(terminate)); await Promise.all(apps.map(deleteApp)); }
});
