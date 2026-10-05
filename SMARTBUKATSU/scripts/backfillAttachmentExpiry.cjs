const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const functionRequire = createRequire(path.join(__dirname, "../functions/package.json"));

function parseOptions(args) {
  const options = { apply: false, maxPages: 1 };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply") { options.apply = true; continue; }
    if (!["--project", "--bucket", "--checkpoint", "--max-pages"].includes(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Invalid or missing migration option");
    options[key.slice(2)] = args[++index];
  }
  options.maxPages = Number(options["max-pages"] || 1);
  if (!options.project || !options.bucket || !options.checkpoint || !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 100) {
    throw new Error("Usage: node scripts/backfillAttachmentExpiry.cjs --project PROJECT --bucket BUCKET --checkpoint FILE [--max-pages 1..100] [--apply]");
  }
  if (options.bucket.includes("/") || options.bucket.includes(":")) throw new Error("Pass a bucket name, without gs://");
  return options;
}

async function main(args) {
  const options = parseOptions(args), checkpoint = path.resolve(options.checkpoint);
  const mode = options.apply ? "apply" : "dry-run";
  let saved = fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, "utf8")) : { project: options.project, bucket: options.bucket, mode, state: {} };
  if (saved.project !== options.project || saved.bucket !== options.bucket || saved.mode !== mode) throw new Error("Checkpoint project, bucket or mode mismatch; choose the correct checkpoint");
  const { initializeApp, applicationDefault, deleteApp } = functionRequire("firebase-admin/app");
  const { getFirestore, FieldValue, FieldPath } = functionRequire("firebase-admin/firestore");
  const { getStorage } = functionRequire("firebase-admin/storage");
  const { createAttachmentExpiryBackend } = require("../functions/attachmentExpiryBackend");
  const { backfillAttachmentExpiryPage } = require("../functions/attachmentExpiryMigration");
  const app = initializeApp({ credential: applicationDefault(), projectId: options.project, storageBucket: options.bucket });
  const firestore = getFirestore(app), bucket = getStorage(app).bucket();
  const backend = createAttachmentExpiryBackend({ firestore, getStorage: () => getStorage(app), FieldValue });
  try {
    for (let page = 0; page < options.maxPages && saved.state.phase !== "complete"; page++) {
      const result = await backfillAttachmentExpiryPage({ firestore, bucket, backend, FieldPath, state: saved.state, apply: options.apply });
      saved = { ...saved, state: result.state };
      fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
      const temporary = checkpoint + ".tmp";
      fs.writeFileSync(temporary, JSON.stringify(saved, null, 2), "utf8");
      fs.renameSync(temporary, checkpoint);
      // Log counts only; never expose object names, user data, tokens or credentials.
      process.stdout.write(JSON.stringify({ mode, phase: result.state.phase, ...result.totals }) + "\n");
    }
  } finally { await firestore.terminate(); await deleteApp(app); }
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  process.stderr.write("Migration failed; checkpoint is unchanged for the failed page. Check credentials, permissions and options, then retry.\n");
  process.exitCode = 1;
});
module.exports = { parseOptions, main };
