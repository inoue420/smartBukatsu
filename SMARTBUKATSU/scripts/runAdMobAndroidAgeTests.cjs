const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { loadAdSdkBridge, extractAndroidBuilder } = require("./adMobAgeTestHarness.cjs");
const { resolveAdAgePolicy } = require("../src/ads/adAgePolicy");
const { ANDROID_SOURCE } = require("./patchAdMobAgeTreatment.cjs");

async function main() {
  const [javaPath, compilerDirArgument] = process.argv.slice(2);
  if (!javaPath || !compilerDirArgument) throw new Error("Usage: node scripts/runAdMobAndroidAgeTests.cjs <java executable> <Kotlin compiler jar directory>");
  const compilerDir = path.resolve(compilerDirArgument);
  const jarNames = ["kotlin-compiler-embeddable-2.1.20.jar", "kotlin-stdlib-2.1.20.jar",
    "kotlin-script-runtime-2.1.20.jar", "kotlin-reflect-1.6.10.jar", "kotlin-daemon-embeddable-2.1.20.jar",
    "trove4j-1.0.20200330.jar", "kotlinx-coroutines-core-jvm-1.8.0.jar", "annotations-13.0.jar"];
  const jars = jarNames.map(name => path.join(compilerDir, name));
  for (const file of [javaPath, ...jars]) assert.ok(fs.existsSync(file), `Missing test runtime: ${path.basename(file)}`);
  const { sdkRoot, mobileAds, configurations } = loadAdSdkBridge();
  const cases = [
    ["unknown", {}, "CHILD"],
    ["teen", { uid: "synthetic", profileResolved: true, minimumAgeConfirmed: true }, "TEEN"],
    ["adult", { uid: "synthetic", profileResolved: true, membershipRole: "guardian" }, "UNSPECIFIED"],
    ["teen-after-adult", { uid: "synthetic", profileResolved: true, minimumAgeConfirmed: true }, "TEEN"],
    ["unknown-after-teen", {}, "CHILD"],
    ["adult-after-unknown", { uid: "synthetic", profileResolved: true, membershipRole: "guardian" }, "UNSPECIFIED"],
  ];
  for (const [, input] of cases) await mobileAds.setRequestConfiguration(resolveAdAgePolicy(input).requestConfiguration);
  const builder = extractAndroidBuilder(fs.readFileSync(path.join(sdkRoot, ANDROID_SOURCE), "utf8"));
  const ktValue = value => typeof value === "boolean" ? String(value) : JSON.stringify(value);
  const checks = cases.map(([label, , expected], index) => {
    const configuration = configurations[index];
    const map = Object.entries(configuration).map(([key, value]) => `${JSON.stringify(key)} to ${ktValue(value)}`).join(", ");
    return `    run {
      val result = native.configure(ReadableMap(mapOf(${map})))
      check(result.age == AgeRestrictedTreatment.${expected}) { "${label}: age-treatment was ignored: " + result.age }
      check(result.rating == ${JSON.stringify(configuration.maxAdContentRating)})
      check(result.childFlag == 0 && result.underAgeFlag == 0)
      println("PASS ${label}: ${expected}")
    }`;
  }).join("\n");
  // Only React bridge containers and the Google builder are test doubles.
  // The private Kotlin method below is extracted unchanged from the installed SDK.
  const kotlin = `enum class AgeRestrictedTreatment { UNSPECIFIED, CHILD, TEEN }
class ReadableArray(private val values: List<Any>) { fun toArrayList() = ArrayList(values) }
class ReadableMap(private val values: Map<String, Any>) {
  fun hasKey(key: String) = values.containsKey(key)
  fun getString(key: String) = values[key] as String?
  fun getBoolean(key: String) = values[key] as Boolean
  fun getArray(key: String) = values[key] as ReadableArray?
}
object AdRequest { const val DEVICE_ID_EMULATOR = "synthetic-emulator" }
data class RequestConfiguration(val age: AgeRestrictedTreatment?, val rating: String?, val childFlag: Int, val underAgeFlag: Int) {
  companion object {
    const val MAX_AD_CONTENT_RATING_G = "G"
    const val MAX_AD_CONTENT_RATING_PG = "PG"
    const val MAX_AD_CONTENT_RATING_T = "T"
    const val MAX_AD_CONTENT_RATING_MA = "MA"
    const val TAG_FOR_CHILD_DIRECTED_TREATMENT_TRUE = 1
    const val TAG_FOR_CHILD_DIRECTED_TREATMENT_FALSE = 0
    const val TAG_FOR_CHILD_DIRECTED_TREATMENT_UNSPECIFIED = -1
    const val TAG_FOR_UNDER_AGE_OF_CONSENT_TRUE = 1
    const val TAG_FOR_UNDER_AGE_OF_CONSENT_FALSE = 0
    const val TAG_FOR_UNDER_AGE_OF_CONSENT_UNSPECIFIED = -1
  }
  class Builder {
    private var age: AgeRestrictedTreatment? = null
    private var rating: String? = null
    private var childFlag = -1
    private var underAgeFlag = -1
    fun setTestDeviceIds(ids: List<String>) = this
    fun setMaxAdContentRating(value: String) = apply { rating = value }
    fun setAgeRestrictedTreatment(value: AgeRestrictedTreatment) = apply { age = value }
    fun setTagForChildDirectedTreatment(value: Int) = apply { childFlag = value }
    fun setTagForUnderAgeOfConsent(value: Int) = apply { underAgeFlag = value }
    fun build() = RequestConfiguration(age, rating, childFlag, underAgeFlag)
  }
}
class NativeUnderTest {
${builder}
  fun configure(values: ReadableMap) = buildRequestConfiguration(values)
}
fun main() {
  val native = NativeUnderTest()
${checks}
}
`;
  const outputDir = path.resolve(__dirname, "../dist/ad-age-treatment/native-age");
  fs.mkdirSync(outputDir, { recursive: true });
  const sourceFile = path.join(outputDir, "AgeTreatmentNativeTest.kt"), outputJar = path.join(outputDir, "age-test.jar");
  fs.writeFileSync(sourceFile, kotlin, "utf8");
  const compile = spawnSync(javaPath, ["-Xmx512m", "-cp", jars.join(path.delimiter), "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
    "-no-stdlib", "-no-reflect", "-classpath", jars[1], "-jvm-target", "17", sourceFile, "-d", outputJar], { encoding: "utf8", timeout: 120000 });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error(`Kotlin compilation failed:\n${compile.stdout}\n${compile.stderr}`);
  const result = spawnSync(javaPath, ["-cp", [outputJar, jars[1]].join(path.delimiter), "AgeTreatmentNativeTestKt"], { encoding: "utf8", timeout: 30000 });
  process.stdout.write(result.stdout || "");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native age-treatment checks failed:\n${result.stderr}`);
  console.log("6 native Kotlin checks passed using values from the installed JS-to-native bridge.");
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
