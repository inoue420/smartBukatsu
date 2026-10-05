const { createHash } = require("node:crypto");
const EXPIRY_COLLECTION = "attachmentExpirations";
const ROOTS = ["calendarAttachments", "dailyReportAttachments"];

function attachmentLocation(storagePath) {
  if (typeof storagePath !== "string") return null;
  const parts = storagePath.split("/");
  if (parts.length !== 5 || parts.some((part) => !part || part === "." || part === "..")) return null;
  const [type, teamId, third, fourth] = parts;
  if (!ROOTS.includes(type)) return null;
  const documentId = type === "calendarAttachments" ? third : fourth;
  const collection = type === "calendarAttachments" ? "clubEvents" : "dailyReports";
  return { type, teamId, documentPath: `teams/${teamId}/${collection}/${documentId}` };
}

function addMonthsIso(value, months) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

function expiryRecord(metadata) {
  const location = attachmentLocation(metadata?.name);
  const generation = String(metadata?.generation || "");
  if (!location || typeof metadata.bucket !== "string" || !metadata.bucket || !/^[1-9]\d*$/.test(generation)) return null;
  // Preserve existing custom expiry; older objects use their original upload time.
  const custom = metadata.metadata || {};
  let expiresAt = Date.parse(custom.expiresAt || "");
  if (!Number.isFinite(expiresAt)) {
    const uploadedAt = Number.isFinite(Date.parse(custom.uploadedAt || "")) ? custom.uploadedAt : metadata.timeCreated;
    const fallback = addMonthsIso(uploadedAt, location.type === "calendarAttachments" ? 3 : 12);
    if (!fallback) return null;
    expiresAt = Date.parse(fallback);
  }
  return { schemaVersion: 1, bucket: metadata.bucket, storagePath: metadata.name, generation,
    type: location.type, teamId: location.teamId, expiresAt, nextAttemptAt: expiresAt,
    documentPaths: [location.documentPath] };
}

const expiryId = (record) => createHash("sha256")
  .update(JSON.stringify([record.bucket, record.storagePath, record.generation])).digest("hex");

function calendarPaths(data) {
  return [...new Set(Object.values(data?.attachmentsByDate || {}).flatMap((items) =>
    Array.isArray(items) ? items.map((item) => item?.storagePath).filter(Boolean) : []))];
}

function removeAttachment(data, type, storagePath, record = null) {
  const retained = (item) => {
    if (item?.storagePath !== storagePath) return true;
    if (record && item.storageGeneration && String(item.storageGeneration) !== record.generation) return true;
    // Old clients lack generation; preserve any reference whose expiry is later than this object.
    if (record && Date.parse(item.expiresAt || "") > record.expiresAt) return true;
    return false;
  };
  if (type === "dailyReportAttachments") {
    if (!Array.isArray(data.attachments)) return null;
    const attachments = data.attachments.filter(retained);
    return attachments.length === data.attachments.length ? null : { attachments };
  }
  let changed = false;
  const attachmentsByDate = {};
  for (const [date, items] of Object.entries(data.attachmentsByDate || {})) {
    if (!Array.isArray(items)) { attachmentsByDate[date] = items; continue; }
    const kept = items.filter(retained);
    if (kept.length !== items.length) changed = true;
    // Preserve unrelated empty dates and values.
    if (kept.length || kept.length === items.length) attachmentsByDate[date] = kept;
  }
  return changed ? { attachmentsByDate } : null;
}

function validDocumentPath(record, value) {
  const parts = typeof value === "string" ? value.split("/") : [];
  const collection = record.type === "calendarAttachments" ? "clubEvents" : "dailyReports";
  return parts.length === 4 && parts[0] === "teams" && parts[1] === record.teamId
    && parts[2] === collection && !!parts[3];
}

module.exports = { EXPIRY_COLLECTION, ROOTS, attachmentLocation, addMonthsIso, expiryRecord, expiryId,
  calendarPaths, removeAttachment, validDocumentPath };
