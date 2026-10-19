const { contentChanges } = require("./loadingOptimizationCore");

function createDailyReportProcessor({ notify, evidence, loading, logger }) {
  return async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;
    const changes = contentChanges("dailyReports", before, after);
    const tasks = [
      ["notification", () => notify(event)],
      ["evidence", () => evidence(event)],
      ["summary_latest", () => loading({ ...event, params: { ...event.params, documentId: event.params.reportId } })],
    ];
    // Each helper checks its own relevant fields before any I/O. One failure
    // must not prevent the other work; a retry is safe for all three branches.
    const results = await Promise.allSettled(tasks.map(([, work]) => Promise.resolve().then(work)));
    const failures = results.flatMap((result, index) => result.status === "rejected" ? [{ branch: tasks[index][0], reason: result.reason }] : []);
    logger.info("daily_report_processing_metrics", { aggregateChanged: changes.aggregate,
      latestChanged: changes.latest, failedBranches: failures.map((failure) => failure.branch),
      noContentChange: !changes.aggregate && !changes.latest });
    if (failures.length) {
      logger.error("Daily report processing failed", { branches: failures.map((failure) => failure.branch) });
      throw failures[0].reason;
    }
  };
}
module.exports = { createDailyReportProcessor };
