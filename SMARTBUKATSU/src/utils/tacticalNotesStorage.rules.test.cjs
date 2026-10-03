// Local Google Storage rules runtime; no cloud credentials or external endpoints.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { createInterface } = require("node:readline");
test("Storage rules compile and restrict tactical images by team, role, editor, type and size", async () => {
  const java = process.env.TACTICAL_TEST_JAVA, jar = process.env.TACTICAL_STORAGE_RULES_JAR;
  assert.ok(java && jar, "Set TACTICAL_TEST_JAVA and TACTICAL_STORAGE_RULES_JAR to local runtime paths");
  const child = spawn(java, ["-jar", jar, "serve"], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let nextId = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let response; try { response = JSON.parse(line); } catch { return; }
    const id = response.id ?? response.server_request_id;
    const handler = pending.get(id); if (handler) { pending.delete(id); handler(response); }
  });
  child.stderr.resume();
  const send = (data, id = nextId++) => new Promise((resolve) => { pending.set(id, resolve); child.stdin.write(JSON.stringify({ ...data, id }) + "\n"); });
  const value = (input) => input === null ? { null_value: null } : typeof input === "string" ? { string_value: input } : typeof input === "number" ? { int_value: input } :
    { map_value: { fields: Object.fromEntries(Object.entries(input).map(([key, item]) => [key, value(item)])) } };
  const projectId = "demo-tactical-notes", team = `storage-${Date.now()}`;
  const { initializeApp, deleteApp } = require("firebase/app");
  const { getFirestore, connectFirestoreEmulator, doc, setDoc, terminate } = require("firebase/firestore");
  const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, team);
  const db = getFirestore(app); connectFirestoreEmulator(db, "127.0.0.1", 8189, { mockUserToken: "owner" });
  try {
    for (const [uid, role] of [["author", "captain"], ["member", "member"], ["staff", "staff"], ["admin", "admin"], ["guardian", "guardian"]]) await setDoc(doc(db, "teams", team, "members", uid), { role });
    await setDoc(doc(db, "teams", team, "tacticalNotes", "note"), { authorUid: "author" });
    const loaded = await send({ action: "load_ruleset", context: { rulesetName: "tactical", source: { files: [{ name: "storage.rules", content: require("node:fs").readFileSync("storage.rules", "utf8") }] } } });
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.status, "ok", JSON.stringify(loaded));
    const verify = async (uid, method, size = 100, contentType = "image/jpeg") => {
      await setDoc(doc(db, "teams", team, "tacticalNotes", "note", "attachmentUploads", "image"), {uploaderUid: uid || "none", size: 100});
      const resource = { size, contentType, metadata: {uploaderUid: uid || "none", uploadId: "image"} };
      let response = await send({ action: "verify", context: { rulesetName: "tactical", service: "firebase.storage",
        path: `/b/${projectId}.appspot.com/o/tacticalNoteAttachments/${team}/note/image.jpg`, method,
        variables: { resource: value(method === "create" ? null : resource), request: value({ auth: uid ? { uid, token: {} } : null, resource: method === "delete" ? null : resource }) } } });
      const accessed = new Set();
      while (response.context) {
        accessed.add(response.context.path);
        assert.ok(accessed.size <= 2, "Storage rules must stay within the two-document Firestore access limit");
        const target = `http://127.0.0.1:8189/v1/projects/${projectId}${response.context.path}`;
        const result = await fetch(target, { headers: { Authorization: "Bearer owner" } });
        const body = await result.json();
        response = await send(result.ok ? { result: { name: body.name, fields: body.fields }, status: "ok", warnings: [], errors: [] } :
          { status: "not_found", warnings: [], errors: [] }, response.server_request_id);
      }
      if (uid === "author" && method === "create" && size === 100 && contentType === "image/jpeg") assert.equal(response.result?.permit, true, JSON.stringify(response));
      return response.result?.permit === true;
    };
    assert.equal(await verify("author", "create"), true);
    assert.equal(await verify("admin", "create"), true);
    assert.equal(await verify("member", "get"), true);
    assert.equal(await verify("author", "delete"), true);
    for (const uid of ["member", "staff", "guardian", "outsider", null]) assert.equal(await verify(uid, "create"), false, uid);
    for (const uid of ["guardian", "outsider", null]) assert.equal(await verify(uid, "get"), false, uid);
    assert.equal(await verify("author", "create", 11 * 1024 * 1024), false);
    assert.equal(await verify("author", "create", 100, "application/pdf"), false);
    assert.equal(await verify("author", "update"), false);
    assert.equal(await verify("member", "delete"), false);
  } finally { child.kill(); lines.close(); await terminate(db); await deleteApp(app); }
});
