const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withAndroidR8Optimization(config) {
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
