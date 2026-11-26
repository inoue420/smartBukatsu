const test = require("node:test");
const assert = require("node:assert/strict");
const { transferVideo } = require("./youtubeUploadProtocol");

const complete = () => Response.json({ id: "abcdefghijk" }, { status: 201 });
function fixture(replies) {
  const requests = [], reads = [], progress = [];
  const run = () => transferVideo({
    size: 40, mime: "video/mp4", check: async () => {}, wait: async () => {},
    read(start, length) { reads.push([start, length]); return new Uint8Array(length); },
    progress: percent => progress.push(percent),
    async put(headers, body) {
      requests.push([headers["Content-Range"], body.length]);
      const response = replies.shift();
      if (!response) throw new Error("connection lost");
      return response;
    },
  });
  return { run, requests, reads, progress };
}
test("resumes after confirmed range; recovers a lost final response without sending video again", async () => {
  const f = fixture([new Response(null, { status: 308, headers: { Range: "bytes=0-7" } }), null, complete()]);
  assert.equal(await f.run(), "abcdefghijk");
  assert.deepEqual(f.requests, [["bytes */40", 0], ["bytes 8-39/40", 32], ["bytes */40", 0]]);
  assert.deepEqual(f.reads, [[8, 32]]);
});
test("already-complete session works even when local file has been removed", async () => {
  const f = fixture([complete()]);
  assert.equal(await f.run(), "abcdefghijk");
  assert.deepEqual(f.reads, []);
});
test("expired, invalid offsets and non-progressing sessions stop without creating a new upload", async () => {
  for (const replies of [[new Response(null, { status: 404 })],
    [new Response(null, { status: 308, headers: { Range: "bytes=0-80" } })],
    [new Response(null, { status: 308 }), new Response(null, { status: 308 })]]) {
    await assert.rejects(fixture(replies).run());
  }
});
