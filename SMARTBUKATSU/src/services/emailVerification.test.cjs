const test = require("node:test"), assert = require("node:assert/strict");
const { load, renderHarness } = require("../../scripts/calendarWeekStartTestHarness.cjs");
const { loadTeamService, loadJoinHandler } = require("../../scripts/emailVerificationTestHarness.cjs");
const { createPendingRegistrationStore } = require("../utils/pendingRegistration");
const idle = () => {}, tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const consent = { minimumAgeConfirmed: true, minorConsentRequirementAcknowledged: true, termsAccepted: true, privacyPolicyAcknowledged: true };
const input = role => ({ role, userName: "Synthetic user", teamName: "Synthetic team", inviteCode: "Ab12Cd", invitationId: "invite-1",
  sport: { category: "sports", name: "soccer", customName: "" }, legalConsent: consent });
function storageEnvironment(values = new Map()) {
  return { values, getItem: async key => values.get(key) || null, setItem: async (key, value) => values.set(key, value), removeItem: async key => values.delete(key) };
}

test("pending inputs survive relaunch, isolate accounts and exclude credentials/unrelated fields", async () => {
  const storage = storageEnvironment(), first = createPendingRegistrationStore(storage);
  await first.save("a", { ...input("admin"), teamId: "stable-team", teamInviteCode: "Ab12Cd", password: "DO_NOT_PERSIST", email: "DO_NOT_PERSIST", extra: "DO_NOT_PERSIST" });
  const raw = [...storage.values.values()][0]; assert.ok(!raw.includes("DO_NOT_PERSIST"));
  const next = createPendingRegistrationStore(storage); assert.equal((await next.read("a")).teamId, "stable-team");
  assert.equal(await next.read("b"), null); await next.remove("a");
  assert.equal(await createPendingRegistrationStore(storage).read("a"), null);
});

test("slow initial reads cannot overwrite newer saved inputs or resurrect a removed registration", async () => {
  const slow = deferred(), storage = storageEnvironment(); storage.getItem = () => slow.promise;
  const store = createPendingRegistrationStore(storage), reading = store.read("a"), saving = store.save("a", input("member"));
  slow.resolve(null); await reading; await saving; assert.equal((await store.read("a")).inviteCode, "Ab12Cd");
  await store.remove("a"); assert.equal(storage.values.size, 0);
});

test("failed persistence is reported and never clears a saved recovery record", async () => {
  const storage = storageEnvironment(), store = createPendingRegistrationStore(storage);
  await store.save("a", input("member")); storage.removeItem = async () => { throw new Error("storage unavailable"); };
  await assert.rejects(store.remove("a"), /storage unavailable/); assert.equal((await store.read("a")).role, "member");
});

test("corrupt saved inputs cannot trigger a creation with a fresh ID on each retry", async () => {
  for (const raw of ["{broken", JSON.stringify(input("admin")), JSON.stringify({ role: "unexpected" })]) {
    const storage = storageEnvironment(new Map([["smartbukatsu:pending-registration:v1:a", raw]]));
    assert.equal(await createPendingRegistrationStore(storage).read("a"), null);
  }
});

async function authHarness(storage = storageEnvironment(), existing = null, profile = null) {
  const h = renderHarness(), calls = [], auth = { currentUser: null }; let callback, authEvent;
  const current = { uid: "synthetic", emailVerified: false, email: "synthetic@example.invalid",
    getIdToken: async force => { calls.push(["token", force]); if (env.tokenFailure) throw new Error("token offline"); } };
  const env = { h, calls, auth, storage, current, verifiedOnReload: false };
  const profiles = new Map(profile ? [[existing?.uid || current.uid, profile]] : []);
  const executeRegistration = async (...args) => { calls.push(["profile", ...args]);
    if (env.profileFailure) throw new Error("profile offline");
    profiles.set(args[0], { name: args[2], emailVerificationRequired: true }); };
  const saveTeam = kind => async (...args) => { calls.push([kind, ...args]);
    if (env.beforeSave) await env.beforeSave(); if (env.teamFailure) throw new Error("team offline");
    return { teamId: kind === "create" ? args[4].teamId : "joined-team" }; };
  const { AuthProvider } = load("src/AuthContext.js", { react: h.react,
    "@react-native-async-storage/async-storage": { __esModule: true, default: storage },
    "./utils/pendingRegistration": { createPendingRegistrationStore },
    "./firebase": { auth, db: "demo" },
    "firebase/auth": { onAuthStateChanged: (_auth, fn) => { callback = fn; return idle; },
      createUserWithEmailAndPassword: async () => { auth.currentUser = current; authEvent = callback(current); return { user: current }; },
      reload: async user => { calls.push(["reload"]); if (env.reloadWait) await env.reloadWait; user.emailVerified = env.verifiedOnReload; },
      sendEmailVerification: async () => { calls.push(["mail"]); if (env.mailFailure) throw new Error("mail offline"); },
      signOut: async () => { auth.currentUser = null; await callback(null); } },
    "firebase/firestore": { doc: (_db, _name, uid) => uid, getDoc: async uid => ({ exists: () => profiles.has(uid), data: () => profiles.get(uid) }),
      setDoc: async (uid, data) => { calls.push(["fallback", uid]); profiles.set(uid, data); }, serverTimestamp: () => "now" },
    "./services/notificationService": { unregisterPushTokenForCurrentDevice: idle, setPushRegistrationSession: idle },
    "./services/firestoreSubscription": { measuredOnSnapshot: (name, ref, next, error) => {
      const subscription = { name, ref, next, error, stopped: false };
      (env.subscriptions ||= []).push(subscription);
      return () => { subscription.stopped = true; };
    } },
    "./services/firestoreService": { executeRegistration, createRegistrationTeamIdentity: () => ({ teamId: "stable-team", teamInviteCode: "Ab12Cd" }),
      createTeam: saveTeam("create"), joinTeamWithInvite: saveTeam("join"), switchActiveTeam: async (_uid, teamId) => { calls.push(["switch", teamId]); } },
  });
  h.mount(() => AuthProvider({ children: null }));
  env.value = () => h.render().props.value;
  env.changeUser = async user => { auth.currentUser = user; await callback(user); h.render(); };
  env.signup = async role => { await env.value().signUp("synthetic@example.invalid", "synthetic-password", input(role)); await authEvent; h.render(); };
  await env.changeUser(existing); return env;
}

for (const role of ["member", "admin"]) test(`${role}: signup saves only profile/inputs and sends mail; verified confirmation alone saves the team`, async () => {
  const a = await authHarness(); await a.signup(role);
  assert.equal(a.calls.filter(c => ["join", "create"].includes(c[0])).length, 0);
  assert.equal(a.calls.find(c => c[0] === "profile").at(-1).deferTeam, true);
  assert.equal(a.value().emailVerificationPending, true); assert.equal(a.value().activeTeamId, null);
  assert.equal(await a.value().refreshEmailVerification(), false); assert.equal(a.calls.filter(c => c[0] === "token").length, 0);
  a.verifiedOnReload = true;
  assert.equal(await a.value().refreshEmailVerification(), true);
  assert.equal(a.value().emailVerificationPending, false); assert.equal(a.storage.values.size, 0);
  const kind = role === "admin" ? "create" : "join", operation = a.calls.find(c => c[0] === kind);
  assert.ok(operation); assert.ok(a.calls.findIndex(c => c[0] === "token") < a.calls.indexOf(operation));
  assert.equal(a.calls.filter(c => c[0] === "profile").length, 1);
  assert.equal(a.value().activeTeamId, role === "admin" ? "stable-team" : "joined-team");
  a.h.unmount();
});

test("verified login after a restart keeps the recovery screen until registration completes", async () => {
  const first = await authHarness(); await first.signup("admin"); first.h.unmount();
  const verified = { ...first.current, emailVerified: true };
  const next = await authHarness(first.storage, verified, { emailVerificationRequired: true }); next.verifiedOnReload = true;
  assert.equal(next.value().emailVerificationPending, true);
  await next.value().refreshEmailVerification(); assert.equal(next.value().emailVerificationPending, false);
  assert.equal(next.calls.find(c => c[0] === "create")[5].teamId, "stable-team"); next.h.unmount();
});

test("failed mail delivery leaves no team; a later confirmation can finish registration", async () => {
  const a = await authHarness(); a.mailFailure = true;
  await assert.rejects(a.signup("member"), /mail offline/);
  assert.equal(a.calls.filter(c => c[0] === "join").length, 0); assert.equal(a.value().emailVerificationPending, true);
  a.mailFailure = false; await a.value().resendVerificationEmail(); a.verifiedOnReload = true;
  await a.value().refreshEmailVerification(); assert.equal(a.calls.filter(c => c[0] === "join").length, 1); a.h.unmount();
});

test("profile failure can recover from saved consent/inputs before attempting a team save", async () => {
  const a = await authHarness(); a.profileFailure = true;
  await assert.rejects(a.signup("member"), /profile offline/); assert.equal(a.calls.filter(c => c[0] === "mail").length, 0);
  a.profileFailure = false; a.verifiedOnReload = true; await a.value().refreshEmailVerification();
  assert.equal(a.calls.filter(c => c[0] === "profile").length, 2);
  assert.equal(a.calls.filter(c => c[0] === "join").length, 1); a.h.unmount();
});

test("token and team failures preserve pending inputs and block entry until a successful retry", async () => {
  const a = await authHarness(); await a.signup("admin"); a.verifiedOnReload = true; a.tokenFailure = true;
  await assert.rejects(a.value().refreshEmailVerification(), /token offline/);
  assert.equal(a.calls.filter(c => c[0] === "create").length, 0); assert.equal(a.value().emailVerificationPending, true);
  a.tokenFailure = false; a.teamFailure = true;
  await assert.rejects(a.value().refreshEmailVerification(), /team offline/); assert.equal(a.storage.values.size, 1);
  assert.equal(a.value().emailVerificationPending, true);
  a.teamFailure = false; await a.value().refreshEmailVerification();
  const attempts = a.calls.filter(c => c[0] === "create"); assert.equal(attempts[0][5].teamId, attempts[1][5].teamId); a.h.unmount();
});

test("double confirmation shares one operation and logout during reload prevents all team writes", async () => {
  const a = await authHarness(); await a.signup("member"); a.verifiedOnReload = true;
  const hold = deferred(); a.beforeSave = () => hold.promise;
  const first = a.value().refreshEmailVerification(), second = a.value().refreshEmailVerification(); assert.equal(first, second);
  await tick(); assert.equal(a.calls.filter(c => c[0] === "join").length, 1); hold.resolve(); await first;
  assert.equal(a.value().emailVerificationPending, false); a.h.unmount();
  const b = await authHarness(); await b.signup("admin"); b.verifiedOnReload = true; const wait = deferred(); b.reloadWait = wait.promise;
  const refreshing = b.value().refreshEmailVerification(); await b.changeUser(null); wait.resolve();
  await assert.rejects(refreshing, /ログイン状態/); assert.equal(b.calls.filter(c => c[0] === "create").length, 0); assert.equal(b.value().user, null); b.h.unmount();
});

test("legacy unverified users may select existing teams but new membership operations require verification", async () => {
  const user = { uid: "legacy", emailVerified: false }, a = await authHarness(storageEnvironment(), user, { emailVerificationRequired: false });
  assert.equal(a.value().emailVerificationPending, false); await a.value().selectTeam("existing");
  await assert.rejects(a.value().joinAndSelectTeam("Ab12Cd", "Synthetic"), /メールアドレス/);
  assert.equal(a.calls.filter(c => c[0] === "join").length, 0); assert.equal(a.value().emailVerificationPending, true); a.h.unmount();
});

function emitProfile(a, data) {
  a.subscriptions.findLast(s => s.name === "authUser" && !s.stopped).next({ exists: () => true, data: () => data });
  a.h.render();
}

test("verified existing users retain access during storage read failure, but new joins wait for recovery", async () => {
  const storage = storageEnvironment();
  const read = storage.getItem;
  storage.getItem = async () => { throw new Error("Synthetic storage read failure"); };
  const user = { uid: "legacy", emailVerified: true }, profile = { activeTeamId: "existing", teamIds: ["existing"], emailVerificationRequired: false };
  const a = await authHarness(storage, user, profile);
  emitProfile(a, profile);
  assert.equal(a.value().emailVerificationPending, false);
  assert.equal(a.value().activeTeamId, "existing");
  await assert.rejects(a.value().joinAndSelectTeam("Ab12Cd", "Synthetic"), /登録情報/);
  assert.equal(a.calls.filter(c => c[0] === "join").length, 0);
  assert.equal(a.value().emailVerificationPending, false);
  await a.value().selectTeam("existing");
  storage.getItem = read;
  await a.value().joinAndSelectTeam("Ab12Cd", "Synthetic");
  assert.equal(a.calls.filter(c => c[0] === "join").length, 1);
  a.h.unmount();
});

test("storage recovery restores a saved registration before allowing another team operation", async () => {
  const storage = storageEnvironment();
  await createPendingRegistrationStore(storage).save("legacy", { ...input("admin"), teamId: "original-registration", teamInviteCode: "Ax12bc", profileSaved: true });
  const read = storage.getItem;
  storage.getItem = async () => { throw new Error("Synthetic storage read failure"); };
  const user = { uid: "legacy", emailVerified: true }, profile = { activeTeamId: "existing", teamIds: ["existing"], emailVerificationRequired: true };
  const a = await authHarness(storage, user, profile); emitProfile(a, profile);
  assert.equal(a.value().emailVerificationPending, false);
  storage.getItem = read;
  await assert.rejects(a.value().createAndSelectTeam("New team", "Synthetic", input("admin").sport), /登録/);
  assert.equal(a.calls.filter(c => c[0] === "create").length, 0);
  assert.equal(a.value().pendingRegistration.teamId, "original-registration");
  assert.equal(a.value().emailVerificationPending, true);
  a.h.unmount();
});

test("storage failure never bypasses verification or releases a user without a team into registration", async () => {
  for (const [verified, required, hasTeam, pending] of [[false, false, true, false], [false, true, true, true], [true, false, false, true]]) {
    const storage = storageEnvironment(); storage.getItem = async () => { throw new Error("Synthetic storage read failure"); };
    const profile = { emailVerificationRequired: required, ...(hasTeam ? { activeTeamId: "existing", teamIds: ["existing"] } : {}) };
    const a = await authHarness(storage, { uid: "legacy", emailVerified: verified }, profile); emitProfile(a, profile);
    assert.equal(a.value().emailVerificationPending, pending);
    await assert.rejects(a.value().joinAndSelectTeam("Ab12Cd", "Synthetic"));
    assert.equal(a.calls.filter(c => c[0] === "join").length, 0);
    a.h.unmount();
  }
});

test("late storage recovery for a previous account cannot start a team save or restore its draft", async () => {
  const storage = storageEnvironment(); storage.getItem = async () => { throw new Error("Synthetic storage read failure"); };
  const profile = { activeTeamId: "existing", teamIds: ["existing"], emailVerificationRequired: false };
  const a = await authHarness(storage, { uid: "legacy", emailVerified: true }, profile); emitProfile(a, profile);
  const wait = deferred(); storage.getItem = () => wait.promise;
  const joining = a.value().joinAndSelectTeam("Ab12Cd", "Synthetic"); await tick();
  await a.changeUser(null); wait.resolve(null);
  await assert.rejects(joining, /ログイン状態/);
  assert.equal(a.value().user, null); assert.equal(a.value().pendingRegistration, null);
  assert.equal(a.calls.filter(c => c[0] === "join").length, 0); a.h.unmount();
});

test("registration retry clears membership revocation only after a successful save", async () => {
  const a = await authHarness(); await a.signup("member"); a.verifiedOnReload = true;
  const remove = a.storage.removeItem; a.storage.removeItem = async () => { throw new Error("Synthetic cleanup failure"); };
  await assert.rejects(a.value().refreshEmailVerification(), /cleanup/);
  emitProfile(a, { activeTeamId: "joined-team", teamIds: ["joined-team"], emailVerificationRequired: true });
  a.subscriptions.findLast(s => s.name === "authMembership" && !s.stopped).next({ exists: () => false }); a.h.render();
  assert.equal(a.value().teamSelectionRequired, true);
  a.storage.removeItem = remove; a.teamFailure = true;
  await assert.rejects(a.value().refreshEmailVerification(), /team offline/);
  assert.equal(a.value().teamSelectionRequired, true);
  a.teamFailure = false; await a.value().refreshEmailVerification();
  assert.equal(a.value().activeTeamId, "joined-team");
  assert.equal(a.value().emailVerificationPending, false);
  assert.equal(a.value().teamSelectionRequired, false); a.h.unmount();
});

test("storage failure preserves consent and permits verified team details to be re-entered", async () => {
  const storage = storageEnvironment(); storage.setItem = async () => { throw new Error("storage unavailable"); };
  const a = await authHarness(storage);
  await assert.rejects(a.signup("member"), /端末に保存できません/);
  assert.equal(a.calls.filter(c => c[0] === "profile").length, 1);
  assert.equal(a.calls.filter(c => c[0] === "join").length, 0);
  a.verifiedOnReload = true; await a.value().refreshEmailVerification();
  assert.equal(a.value().emailVerificationPending, false); assert.equal(a.calls.filter(c => c[0] === "join").length, 0); a.h.unmount();
});

test("unverified users cannot skip registration; a failed verified join can return to team input without joining", async () => {
  const a = await authHarness(); await a.signup("member");
  await assert.rejects(a.value().restartTeamRegistration(), /先にメール/);
  a.verifiedOnReload = true; a.teamFailure = true;
  await assert.rejects(a.value().refreshEmailVerification(), /team offline/);
  assert.equal(a.value().isEmailVerified, true); assert.equal(a.value().emailVerificationPending, true);
  await a.value().restartTeamRegistration();
  assert.equal(a.value().emailVerificationPending, false); assert.equal(a.value().activeTeamId, null);
  assert.equal(a.storage.values.size, 0); assert.equal(a.calls.filter(c => c[0] === "join").length, 1); a.h.unmount();
});

test("failed local cleanup keeps the completed registration retryable with its original team ID", async () => {
  const a = await authHarness(); await a.signup("admin"); a.verifiedOnReload = true;
  const remove = a.storage.removeItem; a.storage.removeItem = async () => { throw new Error("cleanup unavailable"); };
  await assert.rejects(a.value().refreshEmailVerification(), /cleanup unavailable/);
  assert.equal(a.value().emailVerificationPending, true); assert.equal(a.storage.values.size, 1);
  a.storage.removeItem = remove; await a.value().refreshEmailVerification();
  const writes = a.calls.filter(c => c[0] === "create"); assert.equal(writes[0][5].teamId, writes[1][5].teamId);
  assert.equal(a.value().emailVerificationPending, false); a.h.unmount();
});

for (const os of ["android", "ios"]) test(`${os}: confirmation clears only the completed registration invitation; failed attempts keep it`, async () => {
  const h = renderHarness(), cleared = [], alerts = []; let fails = true, verified = false;
  const native = Object.fromEntries(["ActivityIndicator", "Text", "View", "TouchableOpacity"].map(name => [name, name]));
  native.StyleSheet = { create: value => value }; native.Alert = { alert: (...args) => alerts.push(args) };
  const Screen = load("src/screens/EmailVerificationScreen.js", { react: h.react, "react-native": native,
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../hooks/useTeamInvitation": { useTeamInvitation: () => ({ clearInvitation: id => cleared.push(id) }) },
    "../AuthContext": { useAuth: () => ({ user: { email: "synthetic@example.invalid" }, isEmailVerified: verified,
      pendingRegistration: { ...input("member"), invitationId: "original-invitation" },
      refreshEmailVerification: async () => { if (fails) throw new Error("Synthetic invalid invitation"); return true; },
      restartTeamRegistration: async () => {}, resendVerificationEmail: idle, signOut: idle }) },
  }).default;
  h.mount(() => Screen());
  const button = label => h.find(n => n.type === "TouchableOpacity" && h.text(n) === label);
  await button("確認状態を再取得").props.onPress(); h.render(); assert.equal(cleared.length, 0); assert.match(alerts.at(-1)[1], /invalid invitation/);
  verified = true; h.update(); assert.ok(button("チーム情報を入力し直す"));
  fails = false; await button("登録を完了").props.onPress(); h.render(); assert.deepEqual(cleared, ["original-invitation"]); h.unmount();
});

function teamEnvironment() {
  const data = new Map(), stats = { reads: 0, calls: 0, commits: 0 }, auth = { currentUser: { uid: "synthetic", emailVerified: true } };
  const reference = path => ({ path, id: path.split("/").at(-1) });
  const sdk = { collection: (_db, ...segments) => reference(segments.join("/")),
    doc: (base, ...segments) => segments.length ? reference(segments.join("/")) : reference(base.path + "/Ax12bcSynthetic"),
    serverTimestamp: () => "now", arrayUnion: (...values) => ({ union: values }),
    getDoc: async ref => { stats.reads++; return { exists: () => data.has(ref.path), data: () => data.get(ref.path) }; },
    setDoc: async () => assert.fail("team creation must be atomic"),
    writeBatch: () => { const writes = []; return { set: (...args) => writes.push(args), commit: async () => {
      if (stats.failBefore) throw new Error("batch offline");
      stats.beforeCommit?.(); stats.beforeCommit = null;
      for (const [ref, fields, options] of writes) {
        const value = { ...(options?.merge ? data.get(ref.path) : {}), ...fields };
        if (fields.teamIds?.union) value.teamIds = [...new Set([...(data.get(ref.path)?.teamIds || []), ...fields.teamIds.union])];
        data.set(ref.path, value);
      }
      stats.commits++; if (stats.lostResponse) { stats.lostResponse = false; throw new Error("response lost"); }
    } }; },
  };
  const service = loadTeamService("demo", sdk, auth, () => async () => { stats.calls++; return { data: { teamId: "joined" } }; });
  return { data, stats, auth, sdk, service };
}

test("service guards reject unverified users before any Firestore read/write or callable invocation", async () => {
  const a = teamEnvironment(); a.auth.currentUser.emailVerified = false;
  await assert.rejects(a.service.createTeam("synthetic", "Synthetic", "User", input("admin").sport), e => e.code === "auth/email-not-verified");
  await assert.rejects(a.service.joinTeamWithInvite("synthetic", "Ab12Cd"), e => e.code === "auth/email-not-verified");
  assert.equal(a.stats.reads, 0); assert.equal(a.stats.calls, 0); assert.equal(a.data.size, 0);
});

test("a failed atomic team save creates nothing; retry after a lost response returns the same team without rewriting", async () => {
  const a = teamEnvironment(), identity = { teamId: "stable-team", teamInviteCode: "Ab12Cd" }, sport = input("admin").sport;
  a.stats.failBefore = true; await assert.rejects(a.service.createTeam("synthetic", "Synthetic", "User", sport, identity), /batch offline/);
  assert.equal(a.data.size, 0); a.stats.failBefore = false; a.stats.lostResponse = true;
  await assert.rejects(a.service.createTeam("synthetic", "Synthetic", "User", sport, identity), /response lost/);
  assert.equal(a.data.size, 4); assert.equal(a.data.get("teams/stable-team/members/synthetic").role, "admin");
  const result = await a.service.createTeam("synthetic", "Synthetic", "User", sport, identity);
  assert.equal(result.teamId, "stable-team"); assert.equal(a.stats.commits, 1); assert.equal(a.data.size, 4);
});

test("team creation preserves legacy activeTeamId and incomplete membership arrays without another read", async () => {
  for (const teamIds of [undefined, [], ["another-team"]]) {
    const a = teamEnvironment();
    a.data.set("users/synthetic", { activeTeamId: "legacy-team", ...(teamIds ? { teamIds } : {}) });
    for (const id of ["legacy-team", "another-team"]) {
      a.data.set(`teams/${id}`, { name: id, createdBy: "synthetic" });
      a.data.set(`teams/${id}/members/synthetic`, { role: "admin" });
    }
    await a.service.createTeam("synthetic", "Synthetic new", "User", input("admin").sport, { teamId: "new-team", teamInviteCode: "Ne12ab" });
    assert.deepEqual(a.data.get("users/synthetic").teamIds, [...(teamIds || []), "legacy-team", "new-team"]);
    assert.equal(a.data.get("users/synthetic").activeTeamId, "new-team");
    assert.equal(a.stats.reads, 2 + 2 * (teamIds?.length ? 2 : 1));
  }
});

test("normalizing legacy IDs does not overwrite another concurrently remembered membership", async () => {
  const a = teamEnvironment();
  a.data.set("users/synthetic", { activeTeamId: "legacy-team" });
  a.data.set("teams/legacy-team", { name: "Synthetic legacy", createdBy: "synthetic" });
  a.data.set("teams/legacy-team/members/synthetic", { role: "admin" });
  a.stats.beforeCommit = () => a.data.set("users/synthetic", { activeTeamId: "concurrent-team", teamIds: ["concurrent-team"] });
  await a.service.createTeam("synthetic", "Synthetic new", "User", input("admin").sport, { teamId: "new-team", teamInviteCode: "Ne12ab" });
  assert.deepEqual(a.data.get("users/synthetic").teamIds, ["concurrent-team", "legacy-team", "new-team"]);
  assert.equal(a.stats.reads, 4);
});

test("deferred registration writes consent/profile only; existing immediate callers also cannot save an unverified team", async () => {
  const a = teamEnvironment(), profiles = []; a.sdk.setDoc = async (...args) => profiles.push(args);
  const service = loadTeamService("demo", a.sdk, a.auth);
  a.auth.currentUser.emailVerified = false;
  const result = await service.executeRegistration("synthetic", "admin", "User", "Team", "", { legalConsent: consent, deferTeam: true });
  assert.equal(result.type, "pending"); assert.equal(profiles.length, 1); assert.equal(a.data.size, 0);
  await assert.rejects(service.executeRegistration("synthetic", "member", "User", "", "Ab12Cd", { legalConsent: {} }), /利用条件/);
});

test("callable rejects missing or unverified authentication before starting a transaction", async () => {
  let reads = 0; const handler = loadJoinHandler({ runTransaction: () => { reads++; throw new Error("should not run"); } }, {});
  await assert.rejects(handler({ data: {} }), { code: "unauthenticated" });
  for (const token of [{}, { email_verified: false }, { email_verified: "true" }]) {
    await assert.rejects(handler({ auth: { uid: "synthetic", token }, data: { inviteCode: "Ab12Cd" } }), { code: "failed-precondition" });
  }
  assert.equal(reads, 0);
  await assert.rejects(handler({ auth: { uid: "synthetic", token: { email_verified: true } }, data: { inviteCode: "" } }), { code: "invalid-argument" });
});
