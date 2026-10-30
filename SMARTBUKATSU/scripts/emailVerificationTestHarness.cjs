const fs = require("node:fs"), path = require("node:path"), { parse } = require("@babel/parser");
const Module = require("node:module"), { transformSync } = require("@babel/core");
const { fillImports } = require("./calendarWeekStartTestHarness.cjs");

function loadTeamService(db, sdk, auth, callable = () => async () => ({ data: { teamId: "joined" } })) {
  const modules = { "firebase/firestore": sdk, "firebase/functions": { httpsCallable: callable },
    "../firebase": { db, auth, cloudFunctions: {} }, "../legal": { MINIMUM_USER_AGE: 13, LEGAL_POLICY_VERSION: "synthetic" } };
  fillImports("src/services/firestoreService.js", modules);
  const filename = path.join(__dirname, "../src/services/firestoreService.js"), compiled = new Module(filename);
  compiled.filename = filename; compiled.require = name => modules[name];
  compiled._compile(transformSync(fs.readFileSync(filename, "utf8"), { configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"] }).code, filename);
  return compiled.exports;
}

function loadJoinHandler(firestore, FieldValue) {
  const source = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
  const node = parse(source, { sourceType: "script" }).program.body.find(item =>
    item.expression?.left?.object?.name === "exports" && item.expression.left.property?.name === "joinTeamWithInvite");
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return new Function("onCall", "HttpsError", "firestore", "FieldValue", "normalizeTeamIds", "DEFAULT_MAX_TEAMS_PER_USER",
    "SHARP_RISE_MAX_TEAMS_PER_USER", "SHARP_RISE_INVITE_CODE", "exports", source.slice(node.start, node.end) + "; return exports.joinTeamWithInvite;")(
    (_options, fn) => fn, HttpsError, firestore, FieldValue,
    data => [...new Set([...(data.teamIds || []), ...(data.activeTeamId ? [data.activeTeamId] : [])])], 5, 100, "SyntheticDebug", {});
}
module.exports = { loadTeamService, loadJoinHandler };
