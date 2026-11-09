const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core");

function loadAdSdkBridge() {
  const sdkRoot = path.dirname(require.resolve("react-native-google-mobile-ads/package.json"));
  function source(file, modules = {}) {
    const filename = path.join(sdkRoot, "src", file);
    const code = transformSync(fs.readFileSync(filename, "utf8"), { filename, configFile: false, babelrc: false,
      plugins: ["@babel/plugin-transform-typescript", "@babel/plugin-transform-modules-commonjs"] }).code;
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, Error,
      require(name) { if (!(name in modules)) throw new Error(`Unexpected SDK dependency: ${name}`); return modules[name]; } });
    return module.exports;
  }
  const validator = source("validateAdRequestConfiguration.ts", {
    "./common": { isPropertySet: (object, key) => Object.prototype.hasOwnProperty.call(object, key),
      isArray: Array.isArray, isBoolean: value => typeof value === "boolean", isObject: value => value !== null && typeof value === "object" },
    "./MaxAdContentRating": source("MaxAdContentRating.ts"),
    "./types/AgeRestrictedTreatment": source("types/AgeRestrictedTreatment.ts"),
  });
  const configurations = [];
  const native = { setRequestConfiguration(config) { configurations.push(config); return Promise.resolve(); } };
  const { MobileAds } = source("MobileAds.ts", {
    "./specs/modules/NativeGoogleMobileAdsModule": { __esModule: true, default: native },
    "./validateAdRequestConfiguration": validator,
    "./internal/SharedEventEmitter": { SharedEventEmitter: { emit() {} } },
    "./internal/GoogleMobileAdsNativeEventEmitter": { GoogleMobileAdsNativeEventEmitter: { addListener() {} } },
  });
  return { sdkRoot, configurations, mobileAds: MobileAds(), ...validator };
}

function extractAndroidBuilder(source) {
  const start = source.indexOf("  private fun buildRequestConfiguration(");
  if (start < 0) throw new Error("Native buildRequestConfiguration method not found");
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unbalanced native buildRequestConfiguration method");
}

module.exports = { loadAdSdkBridge, extractAndroidBuilder };
