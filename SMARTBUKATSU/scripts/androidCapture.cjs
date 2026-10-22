"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const captureRoot = path.join(projectRoot, ".codex-temp", "android-capture");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function inside(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) {
    throw new Error("保存先・ツールのパスが不正です。");
  }
  const target = path.resolve(root, relative);
  const resolved = path.relative(root, target);
  if (!resolved || resolved === ".." || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) {
    throw new Error("専用フォルダの外は使用できません。");
  }
  return target;
}

function parseDevices(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions)\b/);
    if (!match) return [];
    return [{ serial: match[1], state: match[2], label: `device-${crypto.createHash("sha256").update(match[1]).digest("hex").slice(0, 10)}` }];
  });
}

function inspectPng(data) {
  if (!Buffer.isBuffer(data) || data.length < 45 || !data.subarray(0, 8).equals(pngSignature)) {
    throw new Error("端末から正常なPNGが返りませんでした。画像は保存していません。");
  }
  let offset = 8, width = 0, height = 0, hasData = false, ended = false;
  while (offset + 12 <= data.length) {
    const size = data.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > data.length) break;
    const type = data.toString("ascii", offset + 4, offset + 8);
    if (offset === 8) {
      if (type !== "IHDR" || size !== 13) break;
      width = data.readUInt32BE(offset + 8);
      height = data.readUInt32BE(offset + 12);
    }
    if (type === "IDAT" && size > 0) hasData = true;
    if (type === "IEND" && size === 0) { ended = end === data.length; break; }
    offset = end;
  }
  if (!ended || !hasData || !width || !height || width > 16384 || height > 16384) {
    throw new Error("PNGが途中で切れているか、寸法が不正です。画像は保存していません。");
  }
  return { width, height };
}

function loadTools() {
  if (process.platform !== "win32") throw new Error("Windows用の撮影スクリプトです。");
  const manifestPath = path.join(captureRoot, "tools.json");
  if (!fs.existsSync(manifestPath)) throw new Error("先に pwsh -File scripts/setupAndroidCapture.ps1 を実行してください。");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) throw new Error("tools.jsonの形式が対応外です。");
  const adb = inside(captureRoot, manifest.adb);
  const scrcpy = inside(captureRoot, manifest.scrcpy);
  for (const [file, hash] of [[adb, manifest.adbExecutableSha256], [scrcpy, manifest.scrcpyExecutableSha256]]) {
    if (!fs.existsSync(file) || crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== hash) {
      throw new Error("撮影ツールが見つからないか、導入時のチェックサムと一致しません。");
    }
    const relativeRealPath = path.relative(fs.realpathSync(captureRoot), fs.realpathSync(file));
    if (relativeRealPath.startsWith("..") || path.isAbsolute(relativeRealPath)) throw new Error("ツールが専用フォルダの外を参照しています。");
  }
  return { adb, scrcpy, manifest };
}

function run(file, args, binary = false) {
  const result = spawnSync(file, args, { encoding: binary ? null : "utf8", windowsHide: true,
    timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
  // Raw adb diagnostics can contain device serials. Return only a fixed error.
  if (result.error || result.status !== 0) throw new Error("端末コマンドに失敗しました。USB接続・端末の許可・ケーブルを確認してください。");
  return result.stdout;
}

function getDevices(tools) { return parseDevices(run(tools.adb, ["devices", "-l"])); }

function selectUsb(tools, devices) {
  const result = spawnSync(tools.adb, ["-d", "get-serialno"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  const serial = (result.stdout || "").trim();
  if (!result.error && result.status === 0 && devices.some((device) => device.serial === serial && device.state === "device")) return serial;
  if (devices.some((device) => device.state === "unauthorized")) throw new Error("端末側でこのPCのUSBデバッグを許可してください。");
  if (devices.some((device) => device.state === "offline")) throw new Error("端末がofflineです。ロックを解除してUSBを接続し直してください。");
  throw new Error("利用できるUSB端末を1台だけ接続してください。Wi-Fi接続・エミュレーターは選択しません。");
}

function help() {
  console.log(`Android撮影（USB端末1台 / 画像は未加工・非公開）
  node scripts/androidCapture.cjs check
  node scripts/androidCapture.cjs devices
  node scripts/androidCapture.cjs mirror [--control]
  node scripts/androidCapture.cjs capture <半角英数字の画像名>

mirrorは標準で表示のみ。--control指定時はPCから操作可能。
音声・クリップボード自動同期は無効。Wi-Fi接続への変更は行いません。
captureは端末画面全体を保存します。練習用データの画面を先に開いてください。
保存先: .codex-temp/android-capture/captures/`);
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help") { help(); return; }
  if (!["check", "devices", "mirror", "capture"].includes(command)) throw new Error("不明なコマンドです。helpを確認してください。");
  if ((["check", "devices"].includes(command) && args.length) ||
      (command === "mirror" && (args.length > 1 || (args.length === 1 && args[0] !== "--control"))) ||
      (command === "capture" && (args.length !== 1 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(args[0])))) {
    throw new Error("引数が不正です。画像名は半角英数字・ハイフン・下線で80文字以内にしてください。");
  }
  const tools = loadTools();
  if (command === "check") {
    run(tools.adb, ["version"]);
    run(tools.scrcpy, ["--version"]);
    console.log(`ツール確認OK: Platform-Tools ${tools.manifest.platformToolsRevision} / scrcpy ${tools.manifest.scrcpyVersion}`);
  }
  const devices = getDevices(tools);
  if (command === "devices") {
    console.log(devices.length ? devices.map(({ label, state }) => `${label}: ${state}`).join("\n") : "接続端末なし");
    return;
  }
  const serial = selectUsb(tools, devices);
  if (command === "check") {
    const version = run(tools.adb, ["-s", serial, "shell", "getprop", "ro.build.version.release"]).trim();
    const size = run(tools.adb, ["-s", serial, "shell", "wm", "size"]).trim();
    console.log(`USB接続OK / Android ${version}\n${size}`);
    return;
  }
  if (command === "mirror") {
    const mirrorArgs = [`--serial=${serial}`, "--no-audio", "--no-clipboard-autosync",
      "--window-title=SMARTBUKATSU Capture", "--max-size=1600"];
    if (!args.includes("--control")) mirrorArgs.push("--no-control");
    console.log("画面表示を開始します。終了するには表示ウィンドウを閉じてください。");
    // Keep logs private: scrcpy diagnostics include the physical device serial.
    const child = spawn(tools.scrcpy, mirrorArgs, { windowsHide: true, stdio: "ignore",
      env: { ...process.env, ADB: tools.adb } });
    await new Promise((resolve, reject) => {
      child.on("error", () => reject(new Error("scrcpyの起動に失敗しました。")));
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error("画面表示が異常終了しました。接続と端末の映像エンコーダーを確認してください。")));
    });
    return;
  }
  const image = run(tools.adb, ["-s", serial, "exec-out", "screencap", "-p"], true);
  const dimensions = inspectPng(image);
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}-${args[0]}.png`;
  const captures = path.join(captureRoot, "captures");
  fs.mkdirSync(captures, { recursive: true });
  if (fs.realpathSync(captures).toLowerCase() !== captures.toLowerCase()) throw new Error("保存先にリンク・ジャンクションは使用できません。");
  const destination = inside(captures, filename);
  // Preserve binary bytes on every PowerShell version; never overwrite a capture.
  fs.writeFileSync(destination, image, { flag: "wx" });
  console.log(`PNG保存: ${destination}\n${dimensions.width} x ${dimensions.height}px（端末から取得した解像度）`);
}

if (require.main === module) main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { inside, parseDevices, inspectPng, main };
