const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { INVITE_PAGE, PENDING_KEY, REFERRER_KEY, parseInvitationUrl, parseInstallInvitation,
  invitationMessage, createInvitationManager } = require("../utils/teamInvitation");
const { load, renderHarness, fillImports, appHarness } = require("../../scripts/calendarWeekStartTestHarness.cjs");
const idle = () => {}, tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function environment(overrides = {}, values = []) {
  const saved = new Map(values);
  const storage = { getItem: async key => saved.get(key) || null,
    setItem: async (key, value) => saved.set(key, value), removeItem: async key => saved.delete(key) };
  let receive;
  const manager = createInvitationManager({ storage, getInitialURL: async () => null,
    subscribeUrls: callback => { receive = callback; return idle; }, ...overrides });
  return { manager, saved, storage, receive: url => receive(url) };
}

test("only this app's invitation URLs are accepted; code case is preserved", () => {
  for (const url of [`${INVITE_PAGE}?code=Ab12Cd`, "smartbukatsu://invite?code=Ab12Cd",
    `${INVITE_PAGE}?code=%41b12Cd&step=download`]) assert.equal(parseInvitationUrl(url), "Ab12Cd");
  for (const url of ["https://other.invalid/smartbukatsu/invite/?code=Ab12Cd", "http://sharprise.jp/smartbukatsu/invite/?code=Ab12Cd",
    "https://sharprise.jp.evil.invalid/smartbukatsu/invite/?code=Ab12Cd", "smartbukatsu://admin?code=Ab12Cd",
    `${INVITE_PAGE}?code=Ab12Cd&code=Xy98Za`, `${INVITE_PAGE}?code=Ab12Cd&broken=%XX`,
    `${INVITE_PAGE}?code=Ab12Cd#fragment`, `${INVITE_PAGE}?code=too-long`, "smartbukatsu-dev://invite?code=Ab12Cd"])
    assert.equal(parseInvitationUrl(url), "");
  assert.equal(parseInvitationUrl("smartbukatsu-dev://invite?code=Ab12Cd", true), "Ab12Cd");
  assert.equal(parseInstallInvitation("utm_source=invite&invite_code=Ab12Cd"), "Ab12Cd");
  assert.equal(parseInstallInvitation("invite_code=Ab12Cd&invite_code=Xy98Za"), "");
});

test("share text contains both actionable links, fallback code and registration guidance", () => {
  const message = invitationMessage("Synthetic team", "Ab12Cd");
  const urls = message.match(/https:\/\/[^\s]+/g);
  assert.equal(urls.length, 2); urls.forEach(url => assert.equal(parseInvitationUrl(url), "Ab12Cd"));
  assert.match(message, /①.*インストール/); assert.match(message, /②.*戻って/);
  assert.match(message, /確認メール/); assert.match(message, /招待コード：Ab12Cd/);
  assert.throws(() => invitationMessage("Synthetic", "読み込み中..."));
});

test("an invitation survives relaunch and is removed only after explicit completion/cancellation", async () => {
  const first = environment(); await first.manager.initialize();
  first.receive(`${INVITE_PAGE}?code=Ab12Cd`); await first.manager.flush();
  const second = environment({}, [...first.saved]); await second.manager.initialize();
  const pending = second.manager.getSnapshot().pendingInvitation;
  assert.equal(pending.code, "Ab12Cd");
  assert.equal(second.manager.clearInvitation("stale-id"), false);
  assert.equal(second.manager.getSnapshot().pendingInvitation.code, "Ab12Cd");
  assert.equal(second.manager.clearInvitation(pending.id), true); await second.manager.flush();
  assert.equal(second.saved.has(PENDING_KEY), false);
  first.manager.dispose(); second.manager.dispose();
});

test("a live invitation wins over a delayed initial link, saved code and install referrer", async () => {
  const initial = deferred();
  const env = environment({ getInitialURL: () => initial.promise, readReferrer: async () => "invite_code=Old123" },
    [[PENDING_KEY, JSON.stringify({ code: "Old456", id: "saved" })]]);
  const starting = env.manager.initialize(); await tick();
  env.receive(`${INVITE_PAGE}?code=New789`); initial.resolve(`${INVITE_PAGE}?code=Old789`);
  await starting; await env.manager.flush();
  assert.equal(env.manager.getSnapshot().pendingInvitation.code, "New789");
  assert.equal(env.saved.get(REFERRER_KEY), "1"); env.manager.dispose();
});

test("Play invitation is consumed once and never resurrects after a completed join", async () => {
  let calls = 0; const readReferrer = async () => { calls++; return "invite_code=Ab12Cd"; };
  const first = environment({ readReferrer }); await first.manager.initialize();
  first.manager.clearInvitation(first.manager.getSnapshot().pendingInvitation.id); await first.manager.flush();
  const next = environment({ readReferrer }, [...first.saved]); await next.manager.initialize();
  assert.equal(calls, 1); assert.equal(next.manager.getSnapshot().pendingInvitation, null);
  first.manager.dispose(); next.manager.dispose();
});

test("failed or timed out Play lookup leaves normal login available and can retry next launch", async () => {
  for (const readReferrer of [async () => { throw new Error("offline"); }, () => new Promise(idle)]) {
    const env = environment({ readReferrer, nativeTimeout: 10 }); await env.manager.initialize();
    assert.equal(env.manager.getSnapshot().invitationReady, true); assert.equal(env.saved.has(REFERRER_KEY), false);
    assert.equal(env.manager.getSnapshot().pendingInvitation, null); env.manager.dispose();
  }
});

test("queued persistence cannot restore a cleared code, and an old completion cannot clear a new invite", async () => {
  const write = deferred(), env = environment(); let first = true;
  env.storage.setItem = async (key, value) => { if (first) { first = false; await write.promise; } env.saved.set(key, value); };
  await env.manager.initialize(); env.receive(`${INVITE_PAGE}?code=Ab12Cd`);
  const old = env.manager.getSnapshot().pendingInvitation.id;
  env.receive(`${INVITE_PAGE}?code=Xy98Za`);
  assert.equal(env.manager.clearInvitation(old), false);
  env.manager.clearInvitation(env.manager.getSnapshot().pendingInvitation.id);
  write.resolve(); await env.manager.flush(); assert.equal(env.saved.has(PENDING_KEY), false); env.manager.dispose();
});

test("corrupt storage and storage write failure retain usable in-memory invitations", async () => {
  const env = environment({}, [[PENDING_KEY, "{broken"]]); await env.manager.initialize();
  env.storage.setItem = async () => { throw new Error("storage full"); };
  env.receive(`${INVITE_PAGE}?code=Ab12Cd`); await env.manager.flush();
  assert.equal(env.manager.getSnapshot().storageError, true);
  assert.equal(env.manager.getSnapshot().pendingInvitation.code, "Ab12Cd"); env.manager.dispose();
});

function screenEnvironment(screen, initial = {}, services = {}, os = "android") {
  const h = renderHarness(), alerts = [], cleared = [], joined = [], navigations = [], shares = [];
  let invitation = { invitationReady: true, pendingInvitation: { code: "Ab12Cd", id: "invite-1" }, ...initial };
  let auth = { user: { uid: "synthetic" }, activeTeamId: "a", teamIds: [], userName: "Synthetic", ...services.auth };
  auth.joinAndSelectTeam = async (...args) => { joined.push(args); return services.join ? services.join(...args) : { teamId: "new-team" }; };
  auth.selectTeam = async teamId => { navigations.push(teamId); };
  const clearInvitation = id => {
    cleared.push(id); if (invitation.pendingInvitation?.id !== id) return false;
    invitation = { ...invitation, pendingInvitation: null }; h.update(); return true;
  };
  const native = Object.fromEntries(["ActivityIndicator", "View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Modal", "KeyboardAvoidingView", "Switch"].map(n => [n, n]));
  Object.assign(native, { StyleSheet: { create: value => value }, Platform: { OS: os }, Alert: { alert: (...args) => alerts.push(args) },
    Share: { share: async payload => shares.push(payload) }, Clipboard: { setString: idle } });
  const modules = { react: h.react, "react-native": native, "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useFocusEffect: fn => h.react.useEffect(fn, [fn]) },
    "../AuthContext": { useAuth: () => ({ ...auth, signIn: services.signIn || idle, signUp: services.signUp || idle }) },
    "../hooks/useTeamInvitation": { useTeamInvitation: () => ({ ...invitation, clearInvitation }) },
    "../NotificationContext": { useNotifications: () => ({ unreadByTeam: {} }) },
    "../firebase": { auth: { currentUser: { uid: "synthetic" } }, db: "synthetic" },
    "firebase/firestore": { doc: (_db, _collection, id) => id,
      getDoc: services.getDoc || (async id => ({ exists: () => true, data: () => ({ name: `Team ${id}` }) })) },
    "../services/firestoreService": { getUserTeams: async () => services.teams || [], getMaxTeamsForMemberships: () => 5, SHARP_RISE_MAX_TEAMS_PER_USER: 100,
      getTeamInviteCode: async () => "Ab12Cd", subscribeTeamData: () => idle, ...services.firestore },
    "../constants/sportsCategories": require("../constants/sportsCategories"),
    "../legal": { MINIMUM_USER_AGE: 13, SMARTBUKATSU_PRIVACY_URL: "https://example.invalid/privacy", SMARTBUKATSU_TERMS_URL: "https://example.invalid/terms" },
    "../ads/AdManager": { useAds: () => ({ diagnostics: {} }) }, "../ads/adSettings": require("../ads/adSettings"), "../services/firestoreSubscription": {},
    "../ads/adDiagnostics": { formatAdDiagnostics: () => "" }, "../../functions/workspaceAudience": require("../../functions/workspaceAudience"),
    "expo-clipboard": { setStringAsync: async () => true } };
  const file = `src/screens/${screen}.js`; fillImports(file, modules);
  const Component = load(file, modules).default;
  h.mount(() => Component({ navigation: { canGoBack: () => false, getState: () => ({ routeNames: [] }) },
    currentUser: "Synthetic", currentUserUid: "synthetic", userProfiles: { Synthetic: { uid: "synthetic", role: services.role || "admin" } },
    grades: [], positions: [], clubMembers: [], alertThresholds: {} }));
  return { h, alerts, cleared, joined, navigations, shares,
    input: placeholder => h.find(n => n.type === "TextInput" && n.props.placeholder?.startsWith(placeholder)),
    button: label => h.find(n => n.type === "TouchableOpacity" && h.text(n).includes(label)),
    changeInvite(value) { invitation = { ...invitation, ...value }; h.update(); },
    changeAuth(value) { auth = { ...auth, ...value }; h.update(); } };
}

for (const os of ["android", "ios"]) test(`${os}: invitation selects member signup; login tab retains code; no automatic authentication`, async () => {
  let signIns = 0; const s = screenEnvironment("LoginScreen", {}, { signIn: () => signIns++ }, os);
  assert.equal(s.input("例: aB3xY7").props.value, "Ab12Cd");
  assert.match(s.h.text(s.h.render()), /部員として参加/); assert.equal(signIns, 0);
  s.button("ログイン").props.onPress(); s.h.render();
  assert.equal(s.input("例: aB3xY7"), undefined);
  s.button("新規登録").props.onPress(); s.h.render();
  assert.equal(s.input("例: aB3xY7").props.value, "Ab12Cd");
  s.button("この招待を取り消す").props.onPress(); assert.deepEqual(s.cleared, ["invite-1"]); s.h.unmount();
});

test("received code fills team participation without joining; failed join preserves invitation", async () => {
  const s = screenEnvironment("TeamSelectScreen", {}, { join: async () => { throw new Error("invalid invite"); } });
  await tick(); s.h.render(); assert.equal(s.input("例:").props.value, "Ab12Cd"); assert.equal(s.joined.length, 0);
  await s.button("参加する").props.onPress(); s.h.render();
  assert.equal(s.joined.length, 1); assert.deepEqual(s.cleared, []); assert.equal(s.input("例:").props.value, "Ab12Cd"); s.h.unmount();
});

test("signup still requires both consents; the invitation remains until verified registration completes", async () => {
  const signups = [], s = screenEnvironment("LoginScreen", {}, { signUp: async (...args) => signups.push(args) });
  for (const [placeholder, value] of [["例: 山田", "Synthetic"], ["email@example.com", "synthetic@example.invalid"], ["パスワード", "synthetic-password"]]) {
    s.input(placeholder).props.onChangeText(value); s.h.render();
  }
  await s.button("登録して始める").props.onPress(); assert.equal(signups.length, 0); assert.equal(s.cleared.length, 0);
  const checkboxes = s.h.all(n => n.props.accessibilityRole === "checkbox");
  checkboxes[0].props.onPress(); s.h.render(); await s.button("登録して始める").props.onPress(); assert.equal(signups.length, 0);
  s.h.all(n => n.props.accessibilityRole === "checkbox")[1].props.onPress(); s.h.render();
  await s.button("登録して始める").props.onPress();
  assert.equal(signups.length, 1); assert.equal(signups[0][2].inviteCode, "Ab12Cd"); assert.equal(signups[0][2].role, "member");
  assert.equal(signups[0][2].legalConsent.termsAccepted, true); assert.deepEqual(s.cleared, []);
  assert.equal(signups[0][2].invitationId, "invite-1");
  assert.match(s.alerts.at(-1)[0], /確認メール/); s.h.unmount();
});

test("a failed signup retains the received code for a retry", async () => {
  const s = screenEnvironment("LoginScreen", {}, { signUp: async () => { throw new Error("synthetic signup failure"); } });
  for (const [placeholder, value] of [["例: 山田", "Synthetic"], ["email@example.com", "synthetic@example.invalid"], ["パスワード", "synthetic-password"]]) {
    s.input(placeholder).props.onChangeText(value); s.h.render();
  }
  s.h.all(n => n.props.accessibilityRole === "checkbox").forEach(n => n.props.onPress()); s.h.render();
  await s.button("登録して始める").props.onPress(); assert.equal(s.cleared.length, 0);
  assert.equal(s.input("例: aB3xY7").props.value, "Ab12Cd"); s.h.unmount();
});

test("join completion clears the invitation, while a newer invite survives an older join result", async () => {
  for (const newer of [false, true]) {
    const result = deferred(), s = screenEnvironment("TeamSelectScreen", {}, { join: () => result.promise });
    await tick(); s.h.render(); const joining = s.button("参加する").props.onPress();
    if (newer) s.changeInvite({ pendingInvitation: { code: "Xy98Za", id: "invite-2" } });
    result.resolve({ teamId: "joined" }); await joining; s.h.render();
    assert.equal(s.input("例:").props.value, newer ? "Xy98Za" : "");
    assert.deepEqual(s.cleared, ["invite-1"]); s.h.unmount();
  }
});

test("an already joined team can be opened from an invite even at the membership limit", async () => {
  const s = screenEnvironment("TeamSelectScreen", {}, { auth: { teamIds: ["a", "b", "c", "d", "e"] }, teams: [{ id: "a", inviteCode: "Ab12Cd" }] });
  await tick(); s.h.render(); assert.equal(s.button("参加する").props.disabled, false);
  await s.button("参加する").props.onPress(); assert.deepEqual(s.navigations, ["a"]); assert.equal(s.joined.length, 0); s.h.unmount();
});

test("pending invitation routes existing users to participation while preserving the email verification gate", () => {
  const s = appHarness({ invitationReady: true, pendingInvitation: { code: "Ab12Cd", id: "pending" } });
  const screenNames = () => s.h.all(n => n.type === "Screen").map(n => n.props.name);
  assert.ok(screenNames().includes("TeamSelect")); assert.ok(!screenNames().includes("WorkspaceHome"));
  s.change({ emailVerificationPending: true }); assert.ok(screenNames().includes("EmailVerification"));
  s.change({ user: null }); assert.ok(screenNames().includes("Login")); s.h.unmount();
});

test("share waits for the matching team's name/code and ignores a previous team's late result", async () => {
  const slow = deferred(), s = screenEnvironment("SettingsScreen", { pendingInvitation: null }, {
    getDoc: id => id === "a" ? slow.promise : Promise.resolve({ exists: () => true, data: () => ({ name: "Team B" }) }) });
  const label = "部員を招待（LINE・メールなど）";
  assert.equal(s.button(label).props.disabled, true); s.changeAuth({ activeTeamId: "b" }); await tick(); s.h.render();
  slow.resolve({ exists: () => true, data: () => ({ name: "Team A" }) }); await tick(); s.h.render();
  assert.equal(s.button(label).props.disabled, false); await s.button(label).props.onPress();
  assert.match(s.shares[0].message, /^Team Bから/); s.h.unmount();
  const member = screenEnvironment("SettingsScreen", { pendingInvitation: null }, { role: "member" });
  assert.equal(member.button(label), undefined); member.h.unmount();
});

const website = process.env.SMARTBUKATSU_WEBSITE_ROOT;
test("web invitation passes exactly the same case-sensitive code to Play and the app, rejects duplicate codes", { skip: !website }, async () => {
  const script = fs.readFileSync(path.join(website, "smartbukatsu/invite/invite.js"), "utf8");
  for (const search of ["?code=Ab12Cd", "?code=Ab12Cd&code=Xy98Za", "?code=%3Cscript%3E"]) {
    const elements = new Map(); const element = id => {
      if (!elements.has(id)) elements.set(id, { hidden: true, href: "https://play.google.com/store/apps/details?id=com.sharprise.smartbukatsu", addEventListener() {} });
      return elements.get(id);
    };
    vm.runInNewContext(script, { URL, URLSearchParams, window: { location: { search } }, navigator: {},
      document: { getElementById: element, querySelector: () => null } });
    if (search === "?code=Ab12Cd") {
      assert.equal(parseInvitationUrl(element("open-app").href), "Ab12Cd");
      assert.equal(parseInstallInvitation(new URL(element("android-store").href).searchParams.get("referrer")), "Ab12Cd");
      assert.equal(element("invite-code").textContent, "Ab12Cd");
    } else { assert.equal(element("invite-error").hidden, false); assert.equal(element("open-app").hidden, true); }
  }
});
