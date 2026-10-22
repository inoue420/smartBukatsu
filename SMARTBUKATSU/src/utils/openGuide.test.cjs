const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");

const root = path.join(__dirname, "../..");
const babelOptions = {
  configFile: false,
  babelrc: false,
  plugins: [
    "@babel/plugin-transform-react-jsx",
    "@babel/plugin-transform-modules-commonjs",
  ],
};

function load(relativePath, modules) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const { code } = transformSync(source, babelOptions);
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return module.exports;
}

const links = load("src/constants/helpLinks.js", {});
const { SMARTBUKATSU_GUIDE_URL: guideUrl, SMARTBUKATSU_GUIDE_TOPICS: topics } = links;

function guideEnvironment(os, failure) {
  const calls = [];
  const native = {
    Platform: { OS: os },
    Linking: { openURL: async (url) => { calls.push(["external", url]); } },
  };
  const { openGuideUrl } = load("src/utils/openGuide.js", {
    "react-native": native,
    ...(os === "android" ? {
      "expo-web-browser": {
        openBrowserAsync: async (url, options) => {
          calls.push(["customTab", url, { ...options }]);
          if (failure) throw failure;
          return { type: "opened" };
        },
      },
    } : {}),
  });
  return { calls, native, openGuideUrl };
}

test("Android keeps the topic URL and requests a persistent toolbar in the app task", async () => {
  const env = guideEnvironment("android");
  const url = `${guideUrl}#calendar`;
  const result = await env.openGuideUrl(url);
  assert.equal(result.type, "opened");
  assert.deepEqual(env.calls, [["customTab", url, {
    createTask: false, enableBarCollapsing: false, showTitle: true,
  }]]);
});

for (const os of ["ios", "web"]) {
  test(`${os} keeps external linking without loading the Android native module`, async () => {
    const env = guideEnvironment(os);
    await env.openGuideUrl(guideUrl);
    assert.deepEqual(env.calls, [["external", guideUrl]]);
  });
}

test("Android launch errors reach the caller without silently opening an external browser", async () => {
  const failure = new Error("Synthetic browser launch failure");
  const env = guideEnvironment("android", failure);
  await assert.rejects(env.openGuideUrl(guideUrl), (error) => error === failure);
  assert.deepEqual(env.calls.map(([kind]) => kind), ["customTab"]);
});

function helpLinkEnvironment(openGuideUrl) {
  const alerts = [];
  const component = load("src/components/GuideHelpLink.js", {
    react: {
      __esModule: true,
      default: { createElement: (type, props, ...children) => ({ type, props, children }) },
    },
    "react-native": {
      Alert: { alert: (...args) => alerts.push(args) },
      StyleSheet: { create: (styles) => styles },
      Text: "Text",
      TouchableOpacity: "TouchableOpacity",
    },
    "../constants/helpLinks": links,
    "../utils/openGuide": { openGuideUrl },
  }).default;
  return { component, alerts };
}

test("Every existing help topic opens its matching guide section on Android", async () => {
  const env = guideEnvironment("android");
  const { component, alerts } = helpLinkEnvironment(env.openGuideUrl);
  for (const topic of Object.keys(topics)) {
    await component({ topic }).props.onPress();
  }
  assert.deepEqual(env.calls.map(([kind, url]) => [kind, url]),
    Object.keys(topics).map((topic) => ["customTab", `${guideUrl}#${topic}`]));
  assert.equal(alerts.length, 0);
});

test("Missing or unknown help topics still open the guide index", async () => {
  const env = guideEnvironment("android");
  const { component } = helpLinkEnvironment(env.openGuideUrl);
  for (const topic of [undefined, "unknown-topic"]) {
    await component({ topic }).props.onPress();
  }
  assert.deepEqual(env.calls.map(([, url]) => url), [guideUrl, guideUrl]);
});

test("A help link displays the existing error message when the browser fails", async () => {
  const env = guideEnvironment("android", new Error("Synthetic failure"));
  const { component, alerts } = helpLinkEnvironment(env.openGuideUrl);
  await component({ topic: "calendar" }).props.onPress();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], "操作ガイドを開けません");
});

// Execute the real Settings handler without mounting its Firebase-connected screen.
function settingsHandler(env) {
  const source = fs.readFileSync(path.join(root, "src/screens/SettingsScreen.js"), "utf8");
  const { ast } = transformSync(source, {
    configFile: false, babelrc: false, ast: true, code: false,
    parserOpts: { plugins: ["jsx"] },
  });
  let handler;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id.name === "openExternalPage") {
      handler = node.init;
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  assert.ok(handler, "Settings guide handler must exist");
  const alerts = [];
  const open = vm.runInNewContext(`(${source.slice(handler.start, handler.end)})`, {
    SMARTBUKATSU_GUIDE_URL: guideUrl,
    openGuideUrl: env.openGuideUrl,
    Linking: env.native.Linking,
    Alert: { alert: (...args) => alerts.push(args) },
    console: { log() {} },
  });
  return { open, alerts };
}

test("Settings guide index uses the same Android return route as topic links", async () => {
  const env = guideEnvironment("android");
  const { open, alerts } = settingsHandler(env);
  await open(guideUrl, "操作ガイド・Q＆A");
  assert.deepEqual(env.calls.map(([kind, url]) => [kind, url]), [["customTab", guideUrl]]);
  assert.equal(alerts.length, 0);
});

test("Settings legal and support links keep their existing external route", async () => {
  const env = guideEnvironment("android");
  const legal = load("src/legal.js", {});
  const urls = [legal.SMARTBUKATSU_TERMS_URL, legal.SMARTBUKATSU_PRIVACY_URL, legal.SMARTBUKATSU_SUPPORT_URL];
  const { open } = settingsHandler(env);
  for (const url of urls) await open(url, "法務・サポート");
  assert.deepEqual(env.calls, urls.map((url) => ["external", url]));
});

test("Settings shows an error if its guide cannot open", async () => {
  const env = guideEnvironment("android", new Error("Synthetic failure"));
  const { open, alerts } = settingsHandler(env);
  await open(guideUrl, "操作ガイド・Q＆A");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], "ページを開けません");
});
