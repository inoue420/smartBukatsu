const { spawn } = require("node:child_process");
const path = require("node:path");
const project = "demo-daily-report-comments", port = 8187;
const java = process.argv[2];
if (!java) throw new Error("Pass the path to an existing Java 21+ executable.");
const jar = path.join(process.env.USERPROFILE, ".cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar");
const server = spawn(java, ["-jar", jar, "--host", "127.0.0.1", "--port", String(port), "--project_id", project],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-6000); });
server.on("error", error => { logs += error.message; });
(async () => {
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      if (server.exitCode !== null) throw new Error(logs);
      try { const response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok || response.status === 404) break; } catch {}
      if (Date.now() > deadline) throw new Error("Local emulator did not start. " + logs);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const tests = spawn(process.execPath, ["--test", "src/services/dailyReportComments.rules.test.cjs"],
      { windowsHide: true, stdio: "inherit", env: { ...process.env, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`,
        GCLOUD_PROJECT: project, METADATA_SERVER_DETECTION: "none" } });
    process.exitCode = await new Promise((resolve, reject) => { tests.on("exit", resolve); tests.on("error", reject); });
  } catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
  finally { server.kill(); }
})();
