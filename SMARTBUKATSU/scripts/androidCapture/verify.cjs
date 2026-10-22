"use strict";
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require("firebase/auth");
const { getFirestore, connectFirestoreEmulator, doc, getDoc, collection, getDocs, terminate } = require("firebase/firestore");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { CAPTURE_PROJECT, CAPTURE_PORTS: ports, captureFirebaseConfig } = require("../../src/config/captureEnvironment");
async function verify() {
  const state = await require("./run.cjs").status();
  assert.equal(state.projectId, CAPTURE_PROJECT); assert.equal(state.ready, true);
  const settings = captureFirebaseConfig();
  const app = initializeApp({ apiKey: settings.firebaseApiKey, projectId: settings.projectId, authDomain: settings.authDomain }, "capture-verification");
  const auth = getAuth(app), db = getFirestore(app), functions = getFunctions(app, "asia-northeast1");
  connectAuthEmulator(auth, `http://127.0.0.1:${ports.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", ports.firestore); connectFunctionsEmulator(functions, "127.0.0.1", ports.functions);
  try {
    for (const role of ["admin", "staff", "captain", "member", "member-b", "guardian"]) {
      const credential = await signInWithEmailAndPassword(auth, `${role}@capture.invalid`, "PracticeOnly-2026!");
      assert.equal(credential.user.emailVerified, true);
      assert.equal((await getDoc(doc(db, "teams/capture-team"))).data().name, "操作練習用チーム");
      const membership = (await getDoc(doc(db, `teams/capture-team/members/capture-${role}`))).data();
      assert.equal(membership.role, role === "member-b" ? "member" : role);
      assert.equal((await getDocs(collection(db, "teams/capture-team/projects"))).size, 1);
      const post = (await getDoc(doc(db, "teams/capture-team/workspacePosts/practice-post"))).data();
      assert.equal(typeof post.user, "string"); assert(Array.isArray(post.replies));
      if (role === "guardian") await assert.rejects(getDoc(doc(db, "teams/capture-team/tacticalNotes/practice-note")), (error) => error.code === "permission-denied");
      else assert.equal((await getDoc(doc(db, "teams/capture-team/tacticalNotes/practice-note"))).data().title, "パスを受ける前の準備");
      await httpsCallable(functions, "ensureNotificationSummary")({});
      await signOut(auth);
      console.log(`Local role verified: ${role}`);
    }
    const media = await fetch(`http://127.0.0.1:${ports.assets}/practice.webm`, { headers: { Range: "bytes=0-31" } });
    assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 32);
    assert.equal((await fetch(`http://127.0.0.1:${ports.assets}/court.png`)).headers.get("content-type"), "image/png");
    console.log("Local Auth / Firestore permissions / callable Functions / practice media verified.");
  } finally { await terminate(db); await deleteApp(app); }
}
verify().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
