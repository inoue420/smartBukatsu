"use strict";
const fs = require("node:fs");
const path = require("node:path");

async function makeMedia(directory) {
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(path.join(directory, "practice.webm")) && fs.existsSync(path.join(directory, "court.png"))) return;
  const modules = process.env.CAPTURE_NODE_MODULES || path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
  const { chromium } = require(path.join(modules, "playwright"));
  // Reuse the installed Windows browser; do not download another Chromium.
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext("2d");
      function draw(frame) {
        ctx.fillStyle = "#123b50"; ctx.fillRect(0, 0, 640, 360);
        ctx.strokeStyle = "white"; ctx.lineWidth = 3; ctx.strokeRect(30, 65, 580, 265);
        ctx.beginPath(); ctx.moveTo(320, 65); ctx.lineTo(320, 330); ctx.stroke();
        ctx.beginPath(); ctx.arc(320, 197, 55, 0, Math.PI * 2); ctx.stroke();
        ctx.font = "24px sans-serif"; ctx.fillStyle = "white"; ctx.fillText("PRACTICE / SAMPLE VIDEO", 30, 38);
        for (const [x, y] of [[150, 130], [450, 260]]) { ctx.fillStyle = "#75d2ca"; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill(); }
        const t = (frame % 72) / 72; ctx.fillStyle = "#ffb547";
        ctx.beginPath(); ctx.arc(150 + 300 * t, 130 + 130 * t, 10, 0, Math.PI * 2); ctx.fill();
      }
      draw(0);
      const png = canvas.toDataURL("image/png").split(",")[1];
      const stream = canvas.captureStream(12);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 300000 });
      const chunks = []; recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const done = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start();
      for (let frame = 0; frame < 96; frame++) { draw(frame); await new Promise((resolve) => setTimeout(resolve, 1000 / 12)); }
      recorder.stop(); await done; stream.getTracks().forEach((track) => track.stop());
      return { png, webm: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())) };
    });
    fs.writeFileSync(path.join(directory, "court.png"), Buffer.from(result.png, "base64"));
    fs.writeFileSync(path.join(directory, "practice.webm"), Buffer.from(result.webm));
  } finally { await browser.close(); }
}
module.exports = { makeMedia };
