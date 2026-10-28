const SUPPORT_CLEANUP_DELAY_MS = 15 * 60 * 1000;

function createDailyMaintenanceHandler({ firestore, Timestamp, logger, cleanupNotifications,
  supportCaseCollection = "supportCases", now = Date.now }) {
  async function cleanupSupportCases(cutoff) {
    let deletedCaseCount = 0;
    while (true) {
      const expiredSnapshot = await firestore.collection(supportCaseCollection)
        .where("deleteAfter", "<=", cutoff).limit(100).get();
      if (expiredSnapshot.empty) break;

      let deletedInBatch = 0;
      for (const caseSnapshot of expiredSnapshot.docs) {
        const caseData = caseSnapshot.data() || {};
        if (caseData.legalHold || caseData.status !== "resolved") continue;
        await firestore.recursiveDelete(caseSnapshot.ref);
        deletedCaseCount += 1;
        deletedInBatch += 1;
      }
      if (deletedInBatch === 0 || expiredSnapshot.size < 100) break;
    }
    logger.info("Expired support cases deleted.", { deletedCaseCount });
    return { deletedCaseCount };
  }

  return async (event) => {
    const scheduledMillis = typeof event?.scheduleTime === "string" ? Date.parse(event.scheduleTime) : NaN;
    if (!Number.isFinite(scheduledMillis)) throw new Error("Daily maintenance requires a valid scheduleTime.");
    // Use the original scheduled time, including delayed deliveries and retries.
    // The 03:45 JST schedule therefore retains the former 03:30 support cutoff.
    const supportCutoff = Timestamp.fromMillis(Math.min(scheduledMillis - SUPPORT_CLEANUP_DELAY_MS, now()));
    const tasks = [
      ["notifications", () => cleanupNotifications()],
      ["supportCases", () => cleanupSupportCases(supportCutoff)],
    ];
    const results = await Promise.allSettled(tasks.map(async ([task, work]) => {
      const startedAt = now();
      try {
        const result = await work();
        logger.info("Daily maintenance task completed.", { task, durationMs: now() - startedAt });
        return result;
      } catch (error) {
        // Do not include API error bodies, case contents or notification data.
        logger.error("Daily maintenance task failed.", { task, durationMs: now() - startedAt });
        throw error;
      }
    }));
    const failedTasks = results.flatMap((result, index) => result.status === "rejected" ? [tasks[index][0]] : []);
    if (failedTasks.length) throw new Error(`Daily maintenance failed: ${failedTasks.join(", ")}`);
  };
}

module.exports = { createDailyMaintenanceHandler };
