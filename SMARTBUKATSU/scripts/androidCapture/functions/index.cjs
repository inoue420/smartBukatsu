"use strict";
const path = require("node:path");
const { assertLocalBackend } = require("../../../src/config/captureEnvironment");
assertLocalBackend(process.env);
if (process.env.FUNCTIONS_EMULATOR !== "true") throw new Error("Functions emulator only.");

// No external push/Maps requests, even if someone adds a token to local test data.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("External requests are disabled in the capture Functions runtime.");
  }
  return originalFetch(input, ...args);
};
const deployed = require(path.resolve(__dirname, "../../../functions/index.js"));
const allowed = ["joinTeamWithInvite", "ensureTacticalNoteSummaries", "cleanupTacticalNoteAttachments",
  "updateTacticalNoteResponseSummary", "updateTacticalNoteProgressSummary", "ensureNotificationSummary",
  "updateNotificationPreferences", "markNotificationRead", "dismissNotification",
  "notifyWorkspacePostWritten", "notifyClubEventWritten", "notifyTeamMemberCreated"];
for (const name of allowed) {
  if (!deployed[name]) throw new Error(`Missing local function: ${name}`);
  exports[name] = deployed[name];
}
