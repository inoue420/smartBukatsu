const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
const { createWorkspaceReactionBackend, migrateWorkspaceReactionsPage, receiptId } = require("../../functions/workspaceReactionBackend");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8191" || process.env.GCLOUD_PROJECT !== "demo-workspace-reactions") throw new Error("Use the dedicated local demo emulator.");

test("real emulator: sender privacy, bounded reads, concurrent reactions, migration and account deletion", async (t) => {
  const projectId = process.env.GCLOUD_PROJECT, url = `http://127.0.0.1:8191/emulator/v1/projects/${projectId}:securityRules`;
  const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync("firestore.rules", "utf8") }] } }) });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId }, "reaction-test"), db = admin.getFirestore(serverApp), clients = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  let reads = 0;
  const metered = { collection: (...args) => db.collection(...args), bulkWriter: () => db.bulkWriter(), batch: () => db.batch(),
    runTransaction: (fn) => db.runTransaction((tx) => fn({ get: (ref) => { reads++; return tx.get(ref); },
      set: (...args) => tx.set(...args), update: (...args) => tx.update(...args), delete: (...args) => tx.delete(...args) })) };
  const backend = createWorkspaceReactionBackend({ firestore: metered, FieldValue: admin.FieldValue, HttpsError });
  const team = "synthetic", root = db.collection("teams").doc(team), posts = root.collection("workspacePosts"), privateDocs = root.collection("workspacePostReactionDetails");
  const client = (uid) => { const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `reactions-${uid}`), value = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(value, "127.0.0.1", 8191, { mockUserToken: { sub: uid } }); clients.push({ app, db: value }); return value; };
  const denied = (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
  const send = (uid, postId = "post", emoji = "👍") => backend.submit({ auth: { uid }, data: { teamId: team, postId, emoji } });
  const audience = ["author", "other", "guardian", "captain", "owner", "admin", "staff"];
  try {
    await root.set({ name: "Synthetic team" });
    for (const uid of audience) { await root.collection("members").doc(uid).set({ name: "Same synthetic name", role: ["owner", "admin", "staff", "guardian", "captain"].includes(uid) ? uid : "member" }); await db.collection("users").doc(uid).set({ activeTeamId: team }); }
    const member = client("other"), author = client("author"), guardian = client("guardian"), captain = client("captain"), staff = client("staff"), owner = client("owner"), manager = client("admin"), outsider = client("outsider");
    const postData = { authorUid: "author", visibleToUids: audience, reactions: {}, reactionPrivacyVersion: 1, status: "sent", content: "Synthetic content", channel: "General", replies: [] };
    await posts.doc("post").set(postData);

    await t.test("one send reads three backend documents, counts publish without sender UIDs", async () => {
      reads = 0; assert.equal((await send("other")).added, true); assert.equal(reads, 3);
      const post = (await posts.doc("post").get()).data(); assert.deepEqual(post.reactions, { "👍": 1 }); assert.equal(Object.hasOwn(post, "reactionUserUids"), false);
      assert.equal((await sdk.getDoc(sdk.doc(member, "users", "other", "workspaceReactionReceipts", receiptId(team, "post")))).data().emoji, "👍");
      for (const reader of [author, staff, owner, manager]) assert.equal((await sdk.getDoc(sdk.doc(reader, "teams", team, "workspacePostReactionDetails", "post"))).data().reactors.other, "👍");
    });
    await t.test("other members, captains, guardians and outsiders cannot get or list senders", async () => {
      for (const reader of [member, guardian, captain, outsider]) await denied(sdk.getDoc(sdk.doc(reader, "teams", team, "workspacePostReactionDetails", "post")));
      for (const reader of [member, staff, author]) await denied(sdk.getDocs(sdk.collection(reader, "teams", team, "workspacePostReactionDetails")));
      await denied(sdk.getDoc(sdk.doc(member, "users", "author", "workspaceReactionReceipts", receiptId(team, "post"))));
      await denied(sdk.getDocs(sdk.collection(member, "users", "other", "workspaceReactionReceipts")));
      await denied(sdk.setDoc(sdk.doc(member, "users", "other", "workspaceReactionReceipts", "fake"), { emoji: "👍" }));
      for (const writer of [member, author, staff]) await denied(sdk.setDoc(sdk.doc(writer, "teams", team, "workspacePostReactionDetails", "post"), { reactors: {} }));
    });
    await t.test("author impersonation, direct count edits, legacy map injection and ID reuse are refused", async () => {
      const ref = sdk.doc(member, "teams", team, "workspacePosts", "post");
      for (const change of [{ authorUid: "other" }, { reactions: { "👍": 100 } }, { reactionUserUids: { other: "👍" } }, { reactionPrivacyVersion: 0 }]) await denied(sdk.updateDoc(ref, change));
      await denied(sdk.deleteDoc(ref));
      await denied(sdk.setDoc(sdk.doc(member, "teams", team, "workspacePosts", "forged"), postData));
      await sdk.setDoc(sdk.doc(member, "teams", team, "workspacePosts", "own-created"), { ...postData, authorUid: "other" });
      await sdk.updateDoc(ref, { readByUids: ["other"], replies: [{ user: "Synthetic" }] });
      await privateDocs.doc("used-id").set({ authorUid: "author", reactors: { author: "👍" } });
      await denied(sdk.setDoc(sdk.doc(member, "teams", team, "workspacePosts", "used-id"), { ...postData, authorUid: "other" }));
    });
    await t.test("existing post services preserve stamps across shared diary creation, replies, pinning, audiences and reads", async () => {
      const source = fs.readFileSync(path.join(__dirname, "firestoreService.js"), "utf8");
      const names = ["createWorkspacePost", "updateWorkspacePost", "appendWorkspacePostReply", "updateWorkspacePostReply",
        "markWorkspacePostRead", "updateWorkspacePostAudiences", "incrementWorkspacePostReaction"];
      const declarations = require("@babel/parser").parse(source, { sourceType: "module" }).program.body
        .filter((item) => item.type === "ExportNamedDeclaration" && names.includes(item.declaration?.id?.name))
        .map((item) => source.slice(item.declaration.start, item.declaration.end)).join("\n");
      const services = vm.runInThisContext("(function({ doc, setDoc, addDoc, collection, updateDoc, runTransaction, arrayUnion, serverTimestamp, writeBatch, db, auth, sendWorkspaceReaction }) {" +
        declarations + "\nreturn {" + names.join(",") + "}; })")({ ...sdk, db: author, auth: { currentUser: { uid: "author" } },
        sendWorkspaceReaction: (teamId, postId, emoji) => backend.submit({ auth: { uid: "author" }, data: { teamId, postId, emoji } }) });
      const postId = "surrounding-services", ref = posts.doc(postId);
      assert.equal(await services.createWorkspacePost(team, { ...postData, id: postId, channel: "共有日記", user: "Synthetic", attachments: [], isPinned: false }), postId);
      await send("other", postId, "🔥");
      await services.updateWorkspacePost(team, postId, { content: "Synthetic edited content", isPinned: true });
      await services.appendWorkspacePostReply(team, postId, { id: "reply", authorUid: "author", content: "Synthetic reply" });
      await services.updateWorkspacePostReply(team, postId, "reply", (reply) => ({ ...reply, content: "Synthetic edited reply" }));
      await services.markWorkspacePostRead(team, postId, "author", "Synthetic", false);
      await services.updateWorkspacePostAudiences(team, [{ postId, audience: { shareScope: "roles", visibleToUids: audience, readTargetUids: audience } }]);
      assert.equal(await services.incrementWorkspacePostReaction(team, postId, "❤️", "author"), true);
      assert.equal(await services.incrementWorkspacePostReaction(team, postId, "👍", "author"), false);
      const updated = (await ref.get()).data();
      assert.equal(updated.authorUid, "author"); assert.equal(updated.content, "Synthetic edited content"); assert.equal(updated.isPinned, true);
      assert.equal(updated.replies[0].content, "Synthetic edited reply"); assert.deepEqual(updated.readByUids, ["author"]);
      assert.deepEqual(updated.visibleToUids, audience); assert.deepEqual(updated.reactions, { "🔥": 1, "❤️": 1 });
      assert.equal(Object.hasOwn(updated, "reactionUserUids"), false);
      assert.deepEqual((await privateDocs.doc(postId).get()).data().reactors, { other: "🔥", author: "❤️" });

      const legacyId = "surrounding-legacy", legacyRef = posts.doc(legacyId), legacy = { author: "👍" };
      await legacyRef.set({ ...postData, reactionPrivacyVersion: 0, reactions: { "👍": 1 }, reactionUserUids: legacy });
      await services.updateWorkspacePost(team, legacyId, { isPinned: true });
      await services.appendWorkspacePostReply(team, legacyId, { id: "legacy-reply", content: "Synthetic legacy reply" });
      await services.markWorkspacePostRead(team, legacyId, "author", "Synthetic", false);
      await services.updateWorkspacePostAudiences(team, [{ postId: legacyId, audience: { visibleToUids: audience, readTargetUids: audience } }]);
      const legacyAfter = (await legacyRef.get()).data();
      assert.deepEqual(legacyAfter.reactionUserUids, legacy); assert.deepEqual(legacyAfter.reactions, { "👍": 1 });
      assert.equal(legacyAfter.isPinned, true); assert.equal(legacyAfter.replies.length, 1); assert.deepEqual(legacyAfter.readByUids, ["author"]);
      await sdk.deleteDoc(sdk.doc(author, "teams", team, "workspacePosts", postId));
      await denied(sdk.getDocFromServer(sdk.doc(author, "teams", team, "workspacePostReactionDetails", postId)));
    });
    await t.test("concurrent sends and cross-device duplicates keep one reaction per UID", async () => {
      await posts.doc("concurrent").set(postData);
      const results = await Promise.all([send("author", "concurrent", "👍"), send("other", "concurrent", "🔥"), send("author", "concurrent", "❤️")]);
      assert.equal(results.filter((result) => result.added).length, 2);
      const post = (await posts.doc("concurrent").get()).data(), reactors = (await privateDocs.doc("concurrent").get()).data().reactors;
      assert.equal(Object.values(post.reactions).reduce((sum, count) => sum + count, 0), 2); assert.equal(Object.keys(reactors).length, 2);
      assert.equal((await send("other", "concurrent", "👍")).emoji, "🔥");
      assert.equal((await db.collection("users").doc("other").collection("workspaceReactionReceipts").doc(receiptId(team, "concurrent")).get()).data().emoji, "🔥");
    });
    await t.test("guardians may view their own post; audience, membership, deletion and role changes still apply", async () => {
      await posts.doc("guardian-post").set({ ...postData, authorUid: "guardian" }); await send("other", "guardian-post");
      assert.ok((await sdk.getDoc(sdk.doc(guardian, "teams", team, "workspacePostReactionDetails", "guardian-post"))).exists());
      await posts.doc("restricted").set({ ...postData, visibleToUids: ["author", "other"] }); await send("other", "restricted");
      await denied(sdk.getDoc(sdk.doc(staff, "teams", team, "workspacePostReactionDetails", "restricted")));
      await assert.rejects(send("staff", "restricted"), { code: "permission-denied" });
      await assert.rejects(send("outsider"), { code: "permission-denied" });
      await root.collection("members").doc("staff").update({ role: "member" });
      await denied(sdk.getDocFromServer(sdk.doc(staff, "teams", team, "workspacePostReactionDetails", "post")));
      await root.collection("members").doc("staff").update({ role: "staff" });
      await posts.doc("deleted").set({ ...postData, status: "deleted" });
      await privateDocs.doc("deleted").set({ authorUid: "author", reactors: { other: "👍" } });
      await denied(sdk.getDoc(sdk.doc(author, "teams", team, "workspacePostReactionDetails", "deleted")));
      await assert.rejects(send("other", "deleted"), { code: "permission-denied" });
      await db.collection("users").doc("fallback-only").set({ activeTeamId: team });
      await denied(sdk.getDoc(sdk.doc(client("fallback-only"), "teams", team, "workspacePostReactionDetails", "post")));
    });
    await t.test("bounded dry run does not write; migration preserves counts, receipts and UID-only authors", async () => {
      const ref = posts.doc("legacy"); await ref.set({ ...postData, reactionPrivacyVersion: 0, reactionUserUids: { author: "👍", guardian: "🔥" }, reactions: { "👍": 3, "🔥": 1 } });
      await assert.rejects(send("other", "legacy"), { code: "failed-precondition" });
      const before = (await ref.get()).data();
      const preview = await migrateWorkspaceReactionsPage({ firestore: db, backend, FieldPath: admin.FieldPath, teamId: team, pageSize: 2 });
      assert.ok(preview.totals.scanned <= 2); assert.deepEqual((await ref.get()).data(), before);
      assert.equal(await backend.migratePost(ref), true); assert.equal(await backend.migratePost(ref), false);
      const migrated = (await ref.get()).data(); assert.deepEqual(migrated.reactions, before.reactions); assert.equal(Object.hasOwn(migrated, "reactionUserUids"), false);
      assert.equal((await send("guardian", "legacy", "👍")).added, false); assert.equal((await send("other", "legacy", "👍")).added, true);
      assert.equal((await sdk.getDoc(sdk.doc(guardian, "users", "guardian", "workspaceReactionReceipts", receiptId(team, "legacy")))).data().emoji, "🔥");
      await posts.doc("legacy-no-author").set({ user: "Same synthetic name", reactions: { "👍": 1 }, reactionUserUids: { other: "👍" }, visibleToUids: audience });
      await backend.migratePost(posts.doc("legacy-no-author"));
      await denied(sdk.getDoc(sdk.doc(author, "teams", team, "workspacePostReactionDetails", "legacy-no-author")));
      assert.ok((await sdk.getDoc(sdk.doc(staff, "teams", team, "workspacePostReactionDetails", "legacy-no-author"))).exists());
    });
    await t.test("invalid legacy data is counted in preview and cannot be erased by migration", async () => {
      const ref = posts.doc("!invalid");
      await ref.set({ ...postData, reactionUserUids: { author: 42 } });
      const before = (await ref.get()).data();
      const preview = await migrateWorkspaceReactionsPage({ firestore: db, backend, FieldPath: admin.FieldPath, teamId: team });
      assert.equal(preview.totals.invalid, 1);
      await assert.rejects(backend.migratePost(ref), { code: "failed-precondition" });
      await assert.rejects(migrateWorkspaceReactionsPage({ firestore: db, backend, FieldPath: admin.FieldPath, teamId: team, apply: true }));
      assert.deepEqual((await ref.get()).data(), before); assert.equal((await privateDocs.doc("!invalid").get()).exists, false);
      await ref.update({ reactionUserUids: false }); await assert.rejects(backend.migratePost(ref), { code: "failed-precondition" });
      await ref.delete();
    });
    await t.test("a migration resumes after a failed receipt phase and supports more than 500 writes", async () => {
      const ref = posts.doc("resume"); await ref.set({ ...postData, reactionUserUids: { author: "👍" }, reactions: { "👍": 1 } });
      const failing = createWorkspaceReactionBackend({ firestore: { ...metered, bulkWriter() { throw new Error("synthetic interruption"); } }, FieldValue: admin.FieldValue, HttpsError });
      await assert.rejects(failing.migratePost(ref)); assert.equal((await ref.get()).data().reactionMigrationPending, true);
      await assert.rejects(send("other", "resume"), { code: "failed-precondition" });
      await backend.migratePost(ref); assert.equal(Object.hasOwn((await ref.get()).data(), "reactionMigrationPending"), false);
      const many = Object.fromEntries(Array.from({ length: 601 }, (_, i) => [`synthetic-${i}`, "👍"]));
      await posts.doc("large").set({ ...postData, reactionUserUids: many, reactions: { "👍": 601 } });
      await backend.migratePost(posts.doc("large"));
      assert.equal(Object.keys((await privateDocs.doc("large").get()).data().reactors).length, 601);
      assert.equal((await db.collection("users").doc("synthetic-600").collection("workspaceReactionReceipts").doc(receiptId(team, "large")).get()).data().emoji, "👍");
    });
    await t.test("account deletion finds departed teams and removes sender identities while preserving totals", async () => {
      await root.collection("members").doc("other").delete();
      assert.ok((await backend.relatedTeamIds("other")).includes(team));
      const before = (await posts.doc("post").get()).data().reactions;
      assert.ok(await backend.anonymizeTeam(root, "other") > 0);
      assert.equal(Object.hasOwn((await privateDocs.doc("post").get()).data().reactors, "other"), false);
      assert.deepEqual((await posts.doc("post").get()).data().reactions, before);
      assert.equal((await db.collection("users").doc("other").collection("workspaceReactionReceipts").where("teamId", "==", team).get()).empty, true);
      await backend.anonymizeTeam(root, "author");
      assert.equal((await privateDocs.doc("post").get()).data().authorUid, "");
      const oldAnchor = db.collection("users").doc("author").collection("workspaceReactionTeams").doc(team);
      await oldAnchor.delete(); await send("guardian");
      assert.equal((await oldAnchor.get()).exists, false, "later sends must not restore an erased author's identity anchor");
      await denied(sdk.getDocFromServer(sdk.doc(author, "teams", team, "workspacePostReactionDetails", "post")));
    });
  } finally {
    await Promise.all(clients.map(async ({ app, db: value }) => { await sdk.terminate(value); await deleteApp(app); }));
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
