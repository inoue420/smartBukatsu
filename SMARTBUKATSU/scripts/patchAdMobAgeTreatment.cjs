const fs = require("node:fs");
const path = require("node:path");

const SDK_VERSION = "16.4.0";
const ANDROID_SOURCE = "android/src/main/java/io/invertase/googlemobileads/ReactNativeGoogleMobileAdsModule.kt";
const originalBlock = [
  "      when (ageRestrictedTreatment) {",
  '        "CHILD" -> builder.setAgeRestrictedTreatment(AgeRestrictedTreatment.CHILD)',
  '        "TEEN" -> builder.setAgeRestrictedTreatment(AgeRestrictedTreatment.TEEN)',
  '        "UNSPECIFIED" -> builder.setAgeRestrictedTreatment(AgeRestrictedTreatment.UNSPECIFIED)',
  "      }",
].join("\n");
const correctedBlock = originalBlock.replace(/"(CHILD|TEEN|UNSPECIFIED)"/g, value => value.toLowerCase());

function patchAndroidSource(source) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const before = originalBlock.replace(/\n/g, newline);
  const after = correctedBlock.replace(/\n/g, newline);
  const originalCount = source.split(before).length - 1;
  const correctedCount = source.split(after).length - 1;
  if (originalCount === 1 && correctedCount === 0) {
    return { source: source.replace(before, after), changed: true };
  }
  if (originalCount === 0 && correctedCount === 1) return { source, changed: false };
  throw new Error("AdMob Android age-treatment source is not the reviewed 16.4.0 implementation. Review the native mapping before building.");
}

function readSdk(projectRoot = path.resolve(__dirname, "..")) {
  const manifestPath = require.resolve("react-native-google-mobile-ads/package.json", { paths: [projectRoot] });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.version !== SDK_VERSION) {
    throw new Error(`AdMob age-treatment fix requires reviewed version ${SDK_VERSION}; found ${manifest.version}. Review before updating this fix.`);
  }
  const filename = path.join(path.dirname(manifestPath), ANDROID_SOURCE);
  return { filename, source: fs.readFileSync(filename, "utf8") };
}

function applyAdMobAgeTreatmentPatch(projectRoot) {
  const { filename, source } = readSdk(projectRoot);
  const patched = patchAndroidSource(source);
  if (patched.changed) fs.writeFileSync(filename, patched.source, "utf8");
  return patched.changed;
}

function assertAdMobAgeTreatmentPatched(projectRoot) {
  const { source } = readSdk(projectRoot);
  if (patchAndroidSource(source).changed) {
    throw new Error("AdMob Android age-treatment fix is missing. Run: node scripts/patchAdMobAgeTreatment.cjs. A new native build is required.");
  }
}

if (require.main === module) {
  if (process.argv.includes("--check")) {
    assertAdMobAgeTreatmentPatched();
    console.log("AdMob Android age-treatment mapping verified.");
  } else {
    const changed = applyAdMobAgeTreatmentPatch();
    console.log(changed ? "Applied AdMob 16.4.0 Android age-treatment fix." : "AdMob Android age-treatment fix already applied.");
  }
}

module.exports = { SDK_VERSION, ANDROID_SOURCE, patchAndroidSource,
  applyAdMobAgeTreatmentPatch, assertAdMobAgeTreatmentPatched };
