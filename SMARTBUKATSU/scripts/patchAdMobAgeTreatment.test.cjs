const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { patchAndroidSource, applyAdMobAgeTreatmentPatch, assertAdMobAgeTreatmentPatched,
  ANDROID_SOURCE } = require("./patchAdMobAgeTreatment.cjs");
const { loadAdSdkBridge, extractAndroidBuilder } = require("./adMobAgeTestHarness.cjs");
const root = path.resolve(__dirname, "..");
const sdkRoot = path.dirname(require.resolve("react-native-google-mobile-ads/package.json"));
const installed = fs.readFileSync(path.join(sdkRoot, ANDROID_SOURCE), "utf8");
const unpatched = installed.replace(/"(child|teen|unspecified)"(?= -> builder\.setAgeRestrictedTreatment)/g, value => value.toUpperCase());

function fixture(t, { version = "16.4.0", source = unpatched } = {}) {
  const parent = path.join(root, "dist/ad-age-treatment/native-age"); fs.mkdirSync(parent, { recursive: true });
  const project = fs.mkdtempSync(path.join(parent, "patch-fixture-"));
  const sdk = path.join(project, "node_modules/react-native-google-mobile-ads");
  const native = path.join(sdk, ANDROID_SOURCE);
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.writeFileSync(path.join(sdk, "package.json"), JSON.stringify({ name: "react-native-google-mobile-ads", version }));
  fs.writeFileSync(native, source);
  t.after(() => {
    const target = path.resolve(project);
    assert.equal(path.dirname(target), path.resolve(parent));
    assert.ok(path.basename(target).startsWith("patch-fixture-"));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return { project, native };
}

test("fix changes only the three native string comparisons; repeat runs are idempotent", () => {
  const fixed = patchAndroidSource(unpatched);
  assert.equal(fixed.changed, true);
  assert.equal(fixed.source.replace(/"(child|teen|unspecified)"(?= -> builder\.setAgeRestrictedTreatment)/g,
    value => value.toUpperCase()), unpatched);
  assert.equal(patchAndroidSource(fixed.source).changed, false);
  assert.equal(patchAndroidSource(fixed.source).source, fixed.source);
});

test("install-time fix persists across reinstall and build checks reject missing patch", t => {
  const f = fixture(t);
  assert.throws(() => assertAdMobAgeTreatmentPatched(f.project), /fix is missing/);
  assert.equal(applyAdMobAgeTreatmentPatch(f.project), true);
  assert.doesNotThrow(() => assertAdMobAgeTreatmentPatched(f.project));
  assert.equal(applyAdMobAgeTreatmentPatch(f.project), false);
  fs.writeFileSync(f.native, unpatched);
  assert.throws(() => assertAdMobAgeTreatmentPatched(f.project), /fix is missing/);
  assert.equal(applyAdMobAgeTreatmentPatch(f.project), true);
});

test("unexpected package version or modified native branches stop without overwriting files", t => {
  const version = fixture(t, { version: "16.4.1" });
  assert.throws(() => applyAdMobAgeTreatmentPatch(version.project), /reviewed version/);
  assert.equal(fs.readFileSync(version.native, "utf8"), unpatched);
  for (const source of [unpatched.replace('"TEEN"', '"unexpected"'), unpatched + unpatched]) {
    const f = fixture(t, { source });
    assert.throws(() => applyAdMobAgeTreatmentPatch(f.project), /not the reviewed/);
    assert.equal(fs.readFileSync(f.native, "utf8"), source);
  }
});

test("CRLF source keeps its line endings", () => {
  const crlf = unpatched.replace(/\r?\n/g, "\r\n");
  const result = patchAndroidSource(crlf);
  assert.equal(result.changed, true);
  assert.equal(result.source.replace(/\r\n/g, "").includes("\n"), false);
});

test("installed JS-to-native bridge forwards lower-case age values and rejects upper-case workaround", async () => {
  const { mobileAds, configurations } = loadAdSdkBridge();
  for (const value of ["child", "teen", "unspecified"]) await mobileAds.setRequestConfiguration({ ageRestrictedTreatment: value });
  assert.deepEqual(configurations.map(value => value.ageRestrictedTreatment), ["child", "teen", "unspecified"]);
  for (const value of ["CHILD", "TEEN", "UNSPECIFIED"]) {
    assert.throws(() => mobileAds.setRequestConfiguration({ ageRestrictedTreatment: value }), /expected one of/);
  }
  assert.equal(configurations.length, 3);
});

test("both platform sources recognize the values that actually cross the JS bridge", async () => {
  assertAdMobAgeTreatmentPatched();
  const { mobileAds, configurations } = loadAdSdkBridge();
  for (const ageRestrictedTreatment of ["child", "teen", "unspecified"]) await mobileAds.setRequestConfiguration({ ageRestrictedTreatment });
  const android = extractAndroidBuilder(fs.readFileSync(path.join(sdkRoot, ANDROID_SOURCE), "utf8"));
  const ios = fs.readFileSync(path.join(sdkRoot, "ios/RNGoogleMobileAds/RNGoogleMobileAdsModule.mm"), "utf8");
  const androidValues = [...android.matchAll(/"([^"]+)" -> builder\.setAgeRestrictedTreatment\(AgeRestrictedTreatment\.(\w+)\)/g)];
  for (const { ageRestrictedTreatment } of configurations) {
    assert.equal(androidValues.find(match => match[1] === ageRestrictedTreatment)?.[2], ageRestrictedTreatment.toUpperCase());
    assert.ok(ios.includes(`isEqualToString:@"${ageRestrictedTreatment}"`));
  }
});

test("Expo config refuses an unpatched dependency before returning build settings", t => {
  const f = fixture(t);
  const source = fs.readFileSync(path.join(root, "app.config.js"), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, __dirname: root,
    process: { env: { SMARTBUKATSU_CAPTURE: "1", APP_VARIANT: "development", EXPO_NO_DOTENV: "1" } },
    require(name) {
      if (name === "path") return path;
      if (name === "./app.json") return { expo: { plugins: [] } };
      if (name === "dotenv-flow" || name === "dotenv-expand") return {};
      if (name === "./src/config/captureEnvironment") return require("../src/config/captureEnvironment");
      if (name === "./scripts/patchAdMobAgeTreatment.cjs") return { assertAdMobAgeTreatmentPatched: () => assertAdMobAgeTreatmentPatched(f.project) };
      throw new Error(`Unexpected config dependency: ${name}`);
    },
  });
  assert.throws(() => module.exports({ config: {} }), /fix is missing/);
  applyAdMobAgeTreatmentPatch(f.project);
  assert.doesNotThrow(() => module.exports({ config: {} }));
});
