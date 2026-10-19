const test = require("node:test"), assert = require("node:assert/strict");
const { createDailyReportProcessor } = require("./dailyReportProcessor");
test("unified trigger normalizes IDs and retries failures after running independent branches", async () => {
  const calls = [], logger = { info() {}, error() {} };
  const run = createDailyReportProcessor({ logger,
    notify: async () => { calls.push("notify"); throw new Error("Synthetic retry"); },
    evidence: async () => calls.push("evidence"), loading: async (event) => { calls.push(event.params.documentId); } });
  await assert.rejects(run({ params: { teamId: "team", reportId: "report" }, data: { before: { exists: false }, after: { exists: true, data: () => ({ fatigue: 5 }) } } }), /Synthetic retry/);
  assert.deepEqual(calls.sort(), ["evidence", "notify", "report"]);
});
