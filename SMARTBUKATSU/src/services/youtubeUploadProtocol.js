const CHUNK = 4 * 1024 * 1024;

// Probe before reading local bytes: the final response can be lost after YouTube
// accepted the entire file, even if the local picker cache has since disappeared.
async function transferVideo({ size, mime, put, read, progress, check, wait }) {
  let offset = 0;
  let probe = true;
  let retries = 0;
  while (true) {
    await check();
    const end = Math.min(offset + CHUNK, size);
    const body = probe ? new Uint8Array(0) : read(offset, end - offset);
    if (!probe && body.length !== end - offset) throw new Error("動画が変更されたため再開できません。");
    const range = probe ? "bytes */" + size : "bytes " + offset + "-" + (end - 1) + "/" + size;
    const response = await put({ "Content-Range": range, "Content-Type": mime }, body).catch(() => null);
    if (response?.status === 200 || response?.status === 201) {
      const video = await response.json();
      if (!/^[\w-]{11}$/.test(video?.id || "")) throw new Error("投稿結果を確認できません。同じ投稿を再開してください。");
      return video.id;
    }
    if (response?.status === 308) {
      const rangeHeader = response.headers.get("range");
      const match = /^bytes=0-(\d+)$/.exec(rangeHeader || "");
      const next = rangeHeader == null ? 0 : match ? Number(match[1]) + 1 : NaN;
      if (!Number.isSafeInteger(next) || next < 0 || next > size || (!probe && (next <= offset || next > end))) {
        throw new Error("YouTubeの受信位置を確認できません。同じ投稿を再開してください。");
      }
      if (next === size) throw new Error("全データ送信済みです。少し待って投稿結果を再確認してください。");
      if (next > offset) retries = 0;
      offset = next;
      probe = false;
      progress(offset / size);
      continue;
    }
    if (response?.status === 404 || response?.status === 410) {
      throw new Error("再開期限が切れています。YouTube Studioで投稿結果を確認してください。");
    }
    if (!response || [429, 500, 502, 503, 504].includes(response.status)) {
      if (++retries <= 3) {
        const retryAfter = Number(response?.headers.get("retry-after") || 0);
        if (retryAfter > 60) throw new Error("YouTubeが待機を求めています。時間をおいて再開してください。");
        await wait(Math.max(2 ** (retries - 1), retryAfter || 0) * 1000);
        probe = true;
        continue;
      }
    }
    if (response?.status === 401) throw new Error("認可の期限が切れました。「同じ投稿を再開」で再認証してください。");
    throw new Error("送信が中断されました。通信環境・YouTubeの利用上限を確認して同じ投稿を再開してください。");
  }
}

module.exports = { transferVideo };
