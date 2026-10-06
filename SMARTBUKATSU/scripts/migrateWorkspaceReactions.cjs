const fs = require("node:fs"), path = require("node:path");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../functions/package.json"));

function parseOptions(args) {
  const options = { apply: false, maxPages: 1 };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply") { options.apply = true; continue; }
    if (!["--project", "--team", "--checkpoint", "--max-pages"].includes(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Invalid migration option");
    options[key.slice(2)] = args[++index];
  }
  options.maxPages = Number(options["max-pages"] || 1);
  if (!options.project || !options.team || options.team.includes("/") || !options.checkpoint ||
    !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 100) {
    throw new Error("Usage: node scripts/migrateWorkspaceReactions.cjs --project PROJECT --team TEAM --checkpoint FILE [--max-pages 1..100] [--apply]");
  }
  return options;
}

async function main(args) {
  const options = parseOptions(args), checkpoint = path.resolve(options.checkpoint), mode = options.apply ? "apply" : "dry-run";
  let saved = fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, "utf8"))
    : { project: options.project, team: options.team, mode, cursor: null, complete: false };
  if (saved.project !== options.project || saved.team !== options.team || saved.mode !== mode) throw new Error("Checkpoint does not match project, team or mode");
  const { initializeApp, applicationDefault, deleteApp } = functionRequire("firebase-admin/app");
  const { getFirestore, FieldValue, FieldPath } = functionRequire("firebase-admin/firestore");
  const { HttpsError } = functionRequire("firebase-functions/v2/https");
  const { createWorkspaceReactionBackend, migrateWorkspaceReactionsPage } = require("../functions/workspaceReactionBackend");
  const app = initializeApp({ credential: applicationDefault(), projectId: options.project }), firestore = getFirestore(app);
  const backend = createWorkspaceReactionBackend({ firestore, FieldValue, HttpsError });
  try {
    for (let page = 0; page < options.maxPages && !saved.complete; page++) {
      const result = await migrateWorkspaceReactionsPage({ firestore, backend, FieldPath,
        teamId: options.team, cursor: saved.cursor, apply: options.apply });
      saved = { ...saved, cursor: result.cursor, complete: result.complete };
      fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
      fs.writeFileSync(checkpoint + ".tmp", JSON.stringify(saved, null, 2), "utf8");
      fs.renameSync(checkpoint + ".tmp", checkpoint);
      process.stdout.write(JSON.stringify({ mode, complete: saved.complete, ...result.totals }) + "\n");
    }
  } finally { await firestore.terminate(); await deleteApp(app); }
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  process.stderr.write("Migration failed. The failed page can be retried from its previous checkpoint. No user data or credentials have been logged.\n");
  process.exitCode = 1;
});
module.exports = { parseOptions, main };
