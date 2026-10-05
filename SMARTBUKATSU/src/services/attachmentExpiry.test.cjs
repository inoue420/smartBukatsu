const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core");
const { addMonthsIso } = require("../../functions/attachmentExpiryCore");

function services() {
  const sent = [], closed = [];
  class XMLHttpRequest {
    open(_method, uri) { this.uri = uri; }
    send() { this.response = { size: 1024, close: () => closed.push(this.uri) }; this.onload(); }
  }
  const sdk = { ref: (_storage, target) => target, uploadBytes: async (target, _blob, metadata) => {
    sent.push({ target, metadata }); return { metadata: { generation: "12345678901234567" } };
  }, getDownloadURL: async () => "synthetic", deleteObject: async () => { throw { code: "storage/object-not-found" }; } };
  const load = (name, imports) => {
    const code = transformSync(fs.readFileSync(path.join(__dirname, name), "utf8"), { configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"] }).code;
    const module = { exports: {} };
    vm.runInNewContext("(function(require, module, exports) {" + code + "\n})", { XMLHttpRequest, Date, Math, Set, String, Number, Array, Object, Promise })(
      (id) => imports[id], module, module.exports);
    return module.exports;
  };
  const imports = { "firebase/storage": sdk, "../firebase": { storage: {} }, "expo-image-manipulator": { manipulateAsync: async () => ({}), SaveFormat: { JPEG: "jpeg" } } };
  const calendar = load("calendarAttachmentService.js", imports);
  const diary = load("dailyReportAttachmentService.js", { ...imports, "./calendarAttachmentService": calendar });
  return { calendar, diary, sent, closed };
}

test("client and server preserve matching three- and twelve-month retention", () => {
  const { calendar, diary } = services();
  for (const uploaded of ["2024-02-29T08:00:00Z", "2026-01-31T08:00:00Z", "2026-10-31T08:00:00Z"]) {
    assert.equal(calendar.getCalendarAttachmentExpiryIso(uploaded), addMonthsIso(uploaded, 3));
    assert.equal(diary.getDailyReportAttachmentExpiryIso(uploaded), addMonthsIso(uploaded, 12));
  }
});
test("calendar image and diary PDF uploads retain generation and existing metadata; blobs close", async () => {
  const { calendar, diary, sent, closed } = services();
  const image = await calendar.uploadCalendarAttachment({ teamId: "team", eventId: "event", eventDate: "2026-10-05",
    uploadedBy: "person", attachment: { id: "image", name: "photo.jpg", type: "image", mimeType: "image/jpeg", localUri: "local:image" } });
  const pdf = await diary.uploadDailyReportAttachment({ teamId: "team", authorUid: "person", reportId: "report",
    attachment: { id: "pdf", name: "file.pdf", type: "pdf", mimeType: "application/pdf", localUri: "local:pdf" } });
  assert.equal(image.storageGeneration, "12345678901234567");
  assert.equal(pdf.storageGeneration, "12345678901234567");
  assert.equal(image.expiresAt, sent[0].metadata.customMetadata.expiresAt);
  assert.equal(pdf.expiresAt, sent[1].metadata.customMetadata.expiresAt);
  assert.equal(sent[0].target, "calendarAttachments/team/event/2026-10-05/image.jpg");
  assert.equal(sent[1].target, "dailyReportAttachments/team/person/report/pdf.pdf");
  assert.deepEqual(closed, ["local:image", "local:pdf"]);
});
test("existing manual deletion remains idempotent when the server already deleted the file", async () => {
  const { calendar, diary } = services();
  await calendar.deleteCalendarAttachment("synthetic");
  await diary.deleteDailyReportAttachment("synthetic");
});
