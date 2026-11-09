const { withAppBuildGradle, withSettingsGradle } = require("expo/config-plugins");
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
