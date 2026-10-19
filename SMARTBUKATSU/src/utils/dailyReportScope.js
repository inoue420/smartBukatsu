function dailyReportScope(uid, profiles = {}) {
  const entries = Object.entries(profiles);
  const mine = entries.find(([, profile]) => profile.uid === uid);
  if (!uid || !mine) return { ready: false, authors: [], allAuthors: false, includeShared: false, canSearchAll: false };
  const [key, profile] = mine, role = profile.role;
  const allAuthors = ["owner", "admin"].includes(role) || (role === "staff" && (profile.staffScope || "all") === "all");
  const authors = allAuthors ? [] : role === "staff" ? entries.filter(([, p]) => p.assignedStaff === key)
    : ["member", "captain"].includes(role) ? [mine] : [];
  return { ready: true, role, allAuthors, includeShared: true, canSearchAll: role === "owner",
    authors: authors.filter(([, p]) => p.uid).map(([name, p]) => ({ uid: p.uid, name })).sort((a, b) => a.uid.localeCompare(b.uid)) };
}
function canReadDailyReport(scope, report) {
  if (!scope?.ready || !report || report.status === "deleted") return false;
  if (scope.allAuthors || (scope.includeShared && report.sharedWith === "all")) return true;
  return scope.authors.some((author) => report.authorUid ? report.authorUid === author.uid : report.author === author.name);
}
module.exports = { dailyReportScope, canReadDailyReport };
