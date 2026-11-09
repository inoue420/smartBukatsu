const { withAppBuildGradle, withProjectBuildGradle, withSettingsGradle } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

const R8_OVERRIDE = `  // Google Mobile Ads 25.4.0 contains Kotlin 2.3 metadata.
  buildscript {
    repositories {
      google()
      mavenCentral()
    }
    dependencies {
      classpath("com.android.tools:r8:8.13.19")
    }
  }`;

module.exports = function withAndroidR8Optimization(config) {
  config = withProjectBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("Android Kotlin compiler override requires a Groovy project build.gradle.");
    }
    // The SDK 54 property updates Kotlin/KSP settings but not this classpath.
    // Without an explicit version, React Native supplies compiler 2.1.20.
    const dependency = /classpath\(\s*(["'])org\.jetbrains\.kotlin:kotlin-gradle-plugin(?::[^"']+)?\1\s*\)/g;
    const source = gradleConfig.modResults.contents;
    if ([...source.matchAll(dependency)].length !== 1) {
      throw new Error("Android Kotlin compiler override requires exactly one Kotlin Gradle plugin classpath dependency.");
    }
    gradleConfig.modResults.contents = source.replace(dependency, (_, quote) =>
      `classpath(${quote}org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.20${quote})`,
    );
    return gradleConfig;
  });

  config = withSettingsGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("Android R8 override requires a Groovy settings.gradle.");
    }

    const source = gradleConfig.modResults.contents;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const normalized = source.replace(/\r\n/g, "\n");
    const anchor = /^[ \t]*pluginManagement[ \t]*\{/m;
    if (!anchor.test(normalized)) {
      throw new Error("Android R8 override could not find pluginManagement in settings.gradle.");
    }
    const { contents } = mergeContents({
      src: normalized,
      newSrc: R8_OVERRIDE,
      tag: "smartbukatsu-r8-override",
      anchor,
      offset: 1,
      comment: "//",
    });
    gradleConfig.modResults.contents = contents.replace(/\n/g, newline);
    return gradleConfig;
  });

  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("Android R8 optimization requires a Groovy app build.gradle.");
    }

    // Expo SDK 54's default file disables code optimization with -dontoptimize.
    const contents = gradleConfig.modResults.contents.replace(
      /getDefaultProguardFile\(\s*(["'])proguard-android\.txt\1\s*\)/g,
      (_, quote) =>
        `getDefaultProguardFile(${quote}proguard-android-optimize.txt${quote})`,
    );

    if (
      !/getDefaultProguardFile\(\s*(["'])proguard-android-optimize\.txt\1\s*\)/.test(
        contents,
      )
    ) {
      throw new Error(
        "Android R8 optimization could not find the default ProGuard configuration.",
      );
    }

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
};
