const test = require("node:test"), assert = require("node:assert/strict");
const { attachmentLocation, addMonthsIso, expiryRecord, expiryId, removeAttachment, validDocumentPath } = require("./attachmentExpiryCore");
const { parseOptions } = require("../scripts/backfillAttachmentExpiry.cjs");
const metadata = (overrides = {}) => ({ bucket: "demo-bucket", name: "calendarAttachments/team/event/2026-01-31/image.jpg",
  generation: "12345678901234567", timeCreated: "2026-01-31T10:30:00.000Z", metadata: {}, ...overrides });

test("expiry arithmetic preserves month-end and leap-year retention", () => {
  assert.equal(addMonthsIso("2026-01-31T10:30:00.000Z", 3), "2026-04-30T10:30:00.000Z");
  assert.equal(addMonthsIso("2024-02-29T10:30:00.000Z", 12), "2025-02-28T10:30:00.000Z");
  assert.equal(addMonthsIso("2026-10-31T00:00:00.000Z", 3), "2027-01-31T00:00:00.000Z");
  assert.equal(addMonthsIso(null, 3), null);
});
test("existing expiry is unchanged; missing metadata falls back to original upload time", () => {
  assert.equal(expiryRecord(metadata()).expiresAt, Date.parse("2026-04-30T10:30:00.000Z"));
  assert.equal(expiryRecord(metadata({ metadata: { expiresAt: "2026-05-15T00:00:00Z" } })).expiresAt, Date.parse("2026-05-15T00:00:00Z"));
  assert.equal(expiryRecord(metadata({ name: "dailyReportAttachments/team/user/report/document.pdf",
    metadata: { uploadedAt: "2024-02-29T10:30:00.000Z" } })).expiresAt, Date.parse("2025-02-28T10:30:00.000Z"));
});
test("paths, generations and IDs isolate team, object and bucket", () => {
  for (const name of ["tacticalNoteAttachments/team/note/image.jpg", "calendarAttachments/team/event/date/extra/image.jpg", "calendarAttachments/team//date/image.jpg"]) assert.equal(attachmentLocation(name), null);
  assert.equal(expiryRecord(metadata({ generation: "" })), null);
  assert.equal(expiryRecord(metadata({ timeCreated: undefined })), null);
  const record = expiryRecord(metadata());
  assert.ok(validDocumentPath(record, "teams/team/clubEvents/split"));
  assert.equal(validDocumentPath(record, "teams/other/clubEvents/event"), false);
  assert.notEqual(expiryId(record), expiryId({ ...record, generation: "12345678901234568" }));
  assert.notEqual(expiryId(record), expiryId({ ...record, bucket: "other" }));
});
test("reference cleanup preserves content, comments, unrelated dates and newer generations", () => {
  const path = metadata().name, record = expiryRecord(metadata()), old = { storagePath: path, expiresAt: new Date(record.expiresAt).toISOString() };
  const newer = { ...old, storageGeneration: "other" }, future = { ...old, expiresAt: "2027-01-01T00:00:00Z" };
  const data = { text: "body", comments: ["comment"], attachmentsByDate: { a: [old, newer], b: [old], c: [], d: [future], e: "legacy" } };
  assert.deepEqual(removeAttachment(data, record.type, path, record), { attachmentsByDate: { a: [newer], c: [], d: [future], e: "legacy" } });
  assert.deepEqual(data.comments, ["comment"]);
  assert.deepEqual(removeAttachment({ attachments: [old, future] }, "dailyReportAttachments", path, record), { attachments: [future] });
});
test("migration defaults to dry-run and requires an explicit project, bucket and checkpoint", () => {
  const args = ["--project", "demo-test", "--bucket", "demo-bucket", "--checkpoint", "dist/checkpoint.json"];
  assert.equal(parseOptions(args).apply, false);
  assert.equal(parseOptions([...args, "--apply"]).apply, true);
  assert.throws(() => parseOptions(args.slice(0, 4)));
  assert.throws(() => parseOptions([...args, "--max-pages", "0"]));
  assert.throws(() => parseOptions(["--project", "demo-test", "--bucket", "gs://bucket", "--checkpoint", "file"]));
});
