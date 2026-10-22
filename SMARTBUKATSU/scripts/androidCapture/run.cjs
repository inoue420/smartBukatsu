"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { CAPTURE_PROJECT, CAPTURE_PORTS } = require("../../src/config/captureEnvironment");
const root = path.resolve(__dirname, "../..");
const captureRoot = path.join(root, ".codex-temp/android-capture");
const runtime = path.join(captureRoot, "runtime");
const sessionFile = path.join(runtime, "session.json");
const ports = CAPTURE_PORTS;
const baseUrl = `http://127.0.0.1:${ports.assets}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function status() {
  try {
    const response = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(1500) });
    if (response.ok) { const data = await response.json(); if (data.projectId === CAPTURE_PROJECT) return data; }
  } catch {}
  return { projectId: CAPTURE_PROJECT, running: false, ready: false };
}

function command(file, args) {
  const result = spawnSync(file, args, { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.error || result.status !== 0) throw new Error("USB command failed. Check the connected, authorized device.");
  return result.stdout;
}

function adbPath() {
  const manifest = JSON.parse(fs.readFileSync(path.join(captureRoot, "tools.json"), "utf8"));
  const { inside } = require("../androidCapture.cjs");
  const adb = inside(captureRoot, manifest.adb);
  if (crypto.createHash("sha256").update(fs.readFileSync(adb)).digest("hex") !== manifest.adbExecutableSha256) throw new Error("adb checksum mismatch.");
  return adb;
}

function firebaseCli() {
  const cache = path.join(process.env.USERPROFILE, "AppData/Local/npm-cache/_npx");
  for (const entry of fs.readdirSync(cache)) {
    const directory = path.join(cache, entry, "node_modules/firebase-tools");
    const pkg = path.join(directory, "package.json");
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg)).version === "15.34.0") return path.join(directory, "lib/bin/firebase.js");
  }
  throw new Error("Cached firebase-tools 15.34.0 is required. No package was installed automatically.");
}

async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", () => reject(new Error(`Port ${port} is already in use. Existing services were not stopped.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function worker() {
  fs.mkdirSync(runtime, { recursive: true });
  const lock = path.join(runtime, "worker.lock");
  const lockFd = fs.openSync(lock, "wx");
  fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const children = [], forwarded = [], token = crypto.randomBytes(32).toString("hex");
  let server, stopping = false, ready = false, adb, serial;
  const env = { ...process.env, SMARTBUKATSU_CAPTURE: "1", APP_VARIANT: "development", EXPO_NO_DOTENV: "1",
    GCLOUD_PROJECT: CAPTURE_PROJECT, GOOGLE_CLOUD_PROJECT: CAPTURE_PROJECT,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${ports.firestore}`, FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${ports.auth}`,
    FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${ports.storage}`, FUNCTIONS_EMULATOR: "true",
    METADATA_SERVER_DETECTION: "none", GCE_METADATA_HOST: "127.0.0.1:9", FIREBASE_CLI_DISABLE_USAGE_REPORTING: "true",
    CI: "1", NODE_OPTIONS: "--max-old-space-size=1024", JAVA_TOOL_OPTIONS: "-Xmx512m",
    REACT_NATIVE_PACKAGER_HOSTNAME: "127.0.0.1" };
  for (const name of Object.keys(env)) {
    if (name.startsWith("EXPO_PUBLIC_") || ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN", "FIREBASE_CONFIG", "GOOGLE_SERVICES_JSON"].includes(name)) delete env[name];
  }
  const java = process.env.CAPTURE_JAVA || "C:/projects/IEPpurchase/tmp/iep-p1-010-java/jdk-21.0.12.1+1-jre/bin/java.exe";
  env.JAVA_HOME = path.dirname(path.dirname(java)); env.PATH = `${path.dirname(java)};${env.PATH || env.Path || ""}`;
  async function stop() {
    if (stopping) return;
    stopping = true; ready = false;
    for (const child of children.reverse()) {
      if (child.exitCode === null && child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    }
    for (const port of forwarded) { try { command(adb, ["-s", serial, "reverse", "--remove", `tcp:${port}`]); } catch {} }
    if (server) server.close();
    fs.closeSync(lockFd); fs.unlinkSync(lock);
    process.exit(0);
  }
  function launch(name, args, cwd, environment) {
    const log = fs.openSync(path.join(runtime, `${name}.log`), "a");
    const child = spawn(process.execPath, args, { cwd, env: environment, windowsHide: true, stdio: ["ignore", log, log] });
    fs.closeSync(log); children.push(child);
    child.once("error", () => { console.error(`${name} could not start.`); void stop(); });
    child.once("exit", (code) => { if (!stopping) { console.error(`${name} exited (${code}).`); void stop(); } });
    return child;
  }
  try {
    for (const port of [...Object.values(ports), 4403, 4503, 9153]) await freePort(port);
    if (!fs.existsSync(java)) throw new Error("Java 21+ is required. Set CAPTURE_JAVA to an existing java.exe.");
    adb = adbPath(); serial = command(adb, ["-d", "get-serialno"]).trim();
    if (!serial || serial === "unknown") throw new Error("Connect exactly one USB device.");
    const reverse = command(adb, ["-s", serial, "reverse", "--list"]);
    if (Object.values(ports).some((port) => reverse.includes(`tcp:${port} `))) throw new Error("Capture USB ports are already forwarded. Existing forwarding was not changed.");
    const functionsDir = path.join(runtime, "functions"); fs.mkdirSync(functionsDir, { recursive: true });
    const dependencies = path.join(functionsDir, "node_modules");
    if (!fs.existsSync(dependencies)) fs.symlinkSync(path.join(root, "functions/node_modules"), dependencies, "junction");
    fs.writeFileSync(path.join(functionsDir, "package.json"), JSON.stringify({ private: true, main: "index.cjs", engines: { node: "22" },
      dependencies: JSON.parse(fs.readFileSync(path.join(root, "functions/package.json"))).dependencies }));
    fs.writeFileSync(path.join(functionsDir, "index.cjs"), `module.exports = require(${JSON.stringify(path.join(__dirname, "functions/index.cjs"))});\n`);
    for (const file of ["firestore.rules", "firestore.indexes.json", "storage.rules"]) fs.copyFileSync(path.join(root, file), path.join(runtime, file));
    const config = { functions: [{ source: "functions", codebase: "capture" }],
      firestore: { rules: "firestore.rules", indexes: "firestore.indexes.json" }, storage: { rules: "storage.rules" },
      emulators: { auth: { host: "127.0.0.1", port: ports.auth }, firestore: { host: "127.0.0.1", port: ports.firestore, websocketPort: 9153 },
        functions: { host: "127.0.0.1", port: ports.functions }, storage: { host: "127.0.0.1", port: ports.storage },
        hub: { host: "127.0.0.1", port: 4403 }, logging: { host: "127.0.0.1", port: 4503 }, ui: { enabled: false }, singleProjectMode: true } };
    fs.writeFileSync(path.join(runtime, "firebase.json"), JSON.stringify(config, null, 2));
    fs.writeFileSync(path.join(runtime, ".firebaserc"), JSON.stringify({ projects: { default: CAPTURE_PROJECT } }));
    await require("./media.cjs").makeMedia(path.join(runtime, "media"));
    server = http.createServer((req, res) => {
      if (req.url === "/status" && req.method === "GET") {
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ projectId: CAPTURE_PROJECT, running: true, ready, ports })); return;
      }
      if (req.url === "/stop" && req.method === "POST" && req.headers["x-capture-token"] === token) { res.end("stopping", () => { void stop(); }); return; }
      const name = { "/practice.webm": "practice.webm", "/court.png": "court.png" }[req.url];
      if (!name || !["GET", "HEAD"].includes(req.method)) { res.writeHead(404); res.end(); return; }
      const file = path.join(runtime, "media", name), size = fs.statSync(file).size;
      let start = 0, end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        if (!match) { res.writeHead(416); res.end(); return; }
        start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), size - 1);
        if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return; }
        res.statusCode = 206; res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      }
      res.setHeader("Content-Type", name.endsWith("webm") ? "video/webm" : "image/png");
      res.setHeader("Content-Length", end - start + 1); res.setHeader("Accept-Ranges", "bytes");
      if (req.method === "HEAD") res.end(); else fs.createReadStream(file, { start, end }).pipe(res);
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(ports.assets, "127.0.0.1", resolve); });
    fs.writeFileSync(sessionFile, JSON.stringify({ projectId: CAPTURE_PROJECT, token, startedAt: new Date().toISOString() }));
    launch("firebase", [firebaseCli(), "emulators:start", "--project", CAPTURE_PROJECT, "--config", path.join(runtime, "firebase.json"), "--only", "auth,firestore,functions,storage"], runtime, env);
    const deadline = Date.now() + 120000;
    for (;;) {
      try {
        const response = await fetch("http://127.0.0.1:4403/emulators", { signal: AbortSignal.timeout(1500) });
        const data = await response.json();
        if (["auth", "firestore", "functions", "storage"].every((key) => data[key]?.port === ports[key])) break;
      } catch {}
      if (Date.now() > deadline) throw new Error("Local emulators did not become ready. See runtime/firebase.log.");
      await sleep(500);
    }
    // The parent worker also uses these emulator-only SDK settings for seeding.
    for (const key of ["GCLOUD_PROJECT", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "METADATA_SERVER_DETECTION", "GCE_METADATA_HOST"]) process.env[key] = env[key];
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    await require("./seed.cjs").seed();
    for (const port of Object.values(ports)) { command(adb, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]); forwarded.push(port); }
    launch("metro", [path.join(root, "node_modules/expo/bin/cli"), "start", "--dev-client", "--localhost", "--port", String(ports.metro)], root, env);
    const metroDeadline = Date.now() + 90000;
    for (;;) {
      try { const response = await fetch(`http://127.0.0.1:${ports.metro}/status`); if ((await response.text()).includes("packager-status:running")) break; } catch {}
      if (Date.now() > metroDeadline) throw new Error("Metro did not become ready. See runtime/metro.log.");
      await sleep(500);
    }
    ready = true; console.log("Capture environment ready. No production services were selected.");
  } catch (error) { console.error(error.message); await stop(); }
}

async function main(action) {
  if (action === "worker") { await worker(); return; }
  if (action === "status") { console.log(JSON.stringify(await status(), null, 2)); return; }
  if (action === "start") {
    const current = await status();
    if (current.running) { console.log(JSON.stringify(current)); return; }
    fs.mkdirSync(runtime, { recursive: true });
    if (fs.existsSync(path.join(runtime, "worker.lock"))) throw new Error("Capture startup or shutdown is still in progress. Wait and retry status; see runtime/worker.log if it persists.");
    const log = fs.openSync(path.join(runtime, "worker.log"), "a");
    const child = spawn(process.execPath, [__filename, "worker"], { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
    fs.closeSync(log); child.unref(); console.log("Starting capture environment. Check: node scripts/androidCapture/run.cjs status"); return;
  }
  if (action === "stop") {
    const current = await status();
    if (!current.running) { console.log("Capture environment is not running."); return; }
    const session = JSON.parse(fs.readFileSync(sessionFile));
    if (session.projectId !== CAPTURE_PROJECT) throw new Error("Wrong capture session.");
    const response = await fetch(`${baseUrl}/stop`, { method: "POST", headers: { "x-capture-token": session.token } });
    if (!response.ok) throw new Error("Could not stop this capture session.");
    const deadline = Date.now() + 45000;
    while (fs.existsSync(path.join(runtime, "worker.lock"))) {
      if (Date.now() > deadline) throw new Error("Shutdown has not completed. Inspect runtime/worker.log before restarting.");
      await sleep(250);
    }
    console.log("Capture services stopped; USB forwarding created by this session was removed."); return;
  }
  if (action === "open") {
    if (!(await status()).ready) throw new Error("Start and verify the local capture environment first.");
    const adb = adbPath();
    const url = `smartbukatsu-dev://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${ports.metro}`)}`;
    command(adb, ["-d", "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, "-p", "com.sharprise.smartbukatsu.dev"]);
    console.log("Opened the installed development build with the local capture server."); return;
  }
  throw new Error("Use start, status, open, or stop.");
}
if (require.main === module) main(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { status };
