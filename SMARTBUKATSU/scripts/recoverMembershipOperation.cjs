// Explicit operator action only. Defaults to a three-document, read-only inspect.
// Never log document contents, names, user IDs, lease tokens or credentials.
async function main() {
  const [project, teamId, operationId, preparationId, mode = 'inspect', ...extra] = process.argv.slice(2);
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project || '') || extra.length ||
      ![teamId, operationId].every(value => /^[A-Za-z0-9_-]{1,128}$/.test(value || '')) ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(preparationId || '') || !['inspect', 'resume'].includes(mode)) {
    throw new Error('Usage: node scripts/recoverMembershipOperation.cjs <explicit-project> <team-id> <operation-id> <preparation-id> [inspect|resume]');
  }
  const { createRequire } = require('node:module'), path = require('node:path');
  const dependencies = createRequire(path.join(__dirname, '../functions/package.json'));
  const { initializeApp, deleteApp } = dependencies('firebase-admin/app');
  const { getFirestore, FieldValue, FieldPath } = dependencies('firebase-admin/firestore');
  const { createLoadingOptimizationBackend } = require('../functions/loadingOptimizationBackend');
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const app = initializeApp({ projectId: project });
  try {
    const backend = createLoadingOptimizationBackend({ firestore: getFirestore(app), FieldValue, FieldPath, HttpsError });
    const result = await backend.recoverMembershipBatch(teamId, operationId, preparationId, mode);
    process.stdout.write(JSON.stringify({ mode, ...result }) + '\n');
  } finally { await deleteApp(app); }
}
if (require.main === module) main().catch(() => {
  process.stderr.write('Recovery refused or failed. Inspect scope, generation, lease and credentials before retrying.\n');
  process.exitCode = 1;
});
