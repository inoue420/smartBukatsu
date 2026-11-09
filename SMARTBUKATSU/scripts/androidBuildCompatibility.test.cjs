const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const withAndroidR8Optimization = require("../plugins/withAndroidR8Optimization");

const root = path.resolve(__dirname, "..");
const settings = `pluginManagement {
  includeBuild("../node_modules/@react-native/gradle-plugin")
}
plugins {
  id("com.facebook.react.settings")
}
rootProject.name = "SMARTBUKATSU"
include(":app")
`;

async function applyMod(name, contents, language = "groovy") {
  const config = withAndroidR8Optimization({ name: "SMARTBUKATSU", slug: "smartbukatsu" });
  const result = await config.mods.android[name]({
    ...config,
    modResults: { language, contents },
    modRequest: { projectRoot: root, platformProjectRoot: path.join(root, "android") },
  });
  return result.modResults.contents;
}

test("R8 override is in pluginManagement before React Native plugin resolution and survives repeat prebuilds", async () => {
  const result = await applyMod("settingsGradle", settings);
  const dependency = 'classpath("com.android.tools:r8:8.13.19")';
  assert.ok(result.indexOf(dependency) > result.indexOf("pluginManagement {"));
  assert.ok(result.indexOf(dependency) < result.indexOf("includeBuild("));
  assert.ok(result.includes("google()"));
  assert.ok(result.includes("mavenCentral()"));
  assert.equal(result.match(/com\.android\.tools:r8:/g).length, 1);
  const withoutGeneratedBlock = result.replace(
    /\/\/ @generated begin smartbukatsu-r8-override[^\n]*\n[\s\S]*?\/\/ @generated end smartbukatsu-r8-override\n/,
    "",
  );
  assert.equal(withoutGeneratedBlock, settings);
  assert.equal(await applyMod("settingsGradle", result), result);
});

test("prebuild replaces an older generated R8 override without duplicate dependencies", async () => {
  const result = await applyMod("settingsGradle", settings);
  const older = result.replace(/8\.13\.19/g, "8.10.21").replace(/sync-[a-f0-9]+/, "sync-old");
  const updated = await applyMod("settingsGradle", older);
  assert.equal(updated, result);
  assert.equal(updated.match(/com\.android\.tools:r8:/g).length, 1);
});

test("Windows settings.gradle keeps CRLF and remains idempotent", async () => {
  const result = await applyMod("settingsGradle", settings.replace(/\n/g, "\r\n"));
  assert.equal(result.replace(/\r\n/g, "").includes("\n"), false);
  assert.equal(await applyMod("settingsGradle", result), result);
});

test("unexpected Gradle templates fail rather than silently omitting the compatibility fix", async () => {
  await assert.rejects(applyMod("settingsGradle", settings, "kotlin"), /Groovy settings\.gradle/);
  await assert.rejects(applyMod("settingsGradle", 'include(":app")\n'), /could not find pluginManagement/);
  await assert.rejects(applyMod("appBuildGradle", "", "kotlin"), /Groovy app build\.gradle/);
  await assert.rejects(applyMod("appBuildGradle", "android {}"), /could not find the default ProGuard/);
});

test("existing optimized ProGuard configuration and other app Gradle settings are preserved", async () => {
  for (const quote of ['"', "'"]) {
    const original = `android {\n  buildTypes { release {\n    minifyEnabled true\n    shrinkResources true\n    proguardFiles getDefaultProguardFile(${quote}proguard-android.txt${quote}), 'proguard-rules.pro'\n  } }\n}\n`;
    const result = await applyMod("appBuildGradle", original);
    assert.equal(result, original.replace("proguard-android.txt", "proguard-android-optimize.txt"));
    assert.equal(await applyMod("appBuildGradle", result), result);
  }
});

test("the real app config selects the SDK 54 Kotlin/KSP pair only for Android", () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  const captureEnvironment = require("../src/config/captureEnvironment");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "app.config.js"), "utf8"), {
    module,
    __dirname: root,
    process: { env: { SMARTBUKATSU_CAPTURE: "1", APP_VARIANT: "development", EXPO_NO_DOTENV: "1" } },
    require(name) {
      if (name === "path") return path;
      if (name === "./app.json") return appJson;
      if (name === "dotenv-flow" || name === "dotenv-expand") {
        const refuseEnvFiles = () => { throw new Error("Build compatibility tests must not load environment files."); };
        return { config: refuseEnvFiles, expand: refuseEnvFiles };
      }
      if (name === "./src/config/captureEnvironment") return captureEnvironment;
      if (name === "./scripts/patchAdMobAgeTreatment.cjs") return require("./patchAdMobAgeTreatment.cjs");
      throw new Error(`Unexpected config dependency: ${name}`);
    },
  });
  const resolved = module.exports({ config: {} });
  const buildProperties = resolved.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === "expo-build-properties")[1];
  assert.equal(buildProperties.android.kotlinVersion, "2.2.20");
  assert.equal(buildProperties.android.enableMinifyInReleaseBuilds, true);
  assert.equal(buildProperties.android.enableShrinkResourcesInReleaseBuilds, true);
  assert.equal(buildProperties.ios, undefined);
  const lookup = fs.readFileSync(path.join(root,
    "node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin/src/main/kotlin/expo/modules/plugin/KSPLookup.kt"), "utf8");
  assert.match(lookup, /"2\.2\.20" to "2\.2\.20-2\.0\.3"/);
  const ios = { ...resolved.ios };
  const config = withAndroidR8Optimization(resolved);
  assert.equal(JSON.stringify(config.ios), JSON.stringify(ios));
  assert.equal(config.mods.ios, undefined);
});
