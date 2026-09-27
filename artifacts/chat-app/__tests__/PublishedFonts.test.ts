/**
 * Covers the reading and judging scripts/check-fonts.cjs does.
 *
 * That check is the only thing standing between a build that stops emitting
 * the icon font and a published app whose Chats and Profile tabs are two empty
 * boxes. It proves that by building the app and serving the output, which
 * takes about a minute and cannot run inside jest — so it runs on its own
 * (`pnpm --filter @workspace/chat-app run check:fonts`) and this file covers
 * everything either side of the build: which fonts it decides the app needs,
 * what it reads out of a built bundle, and which answers from the server it
 * treats as a font arriving. Those are the parts that could quietly stop
 * measuring anything while the check still reported success.
 */

// Jest runs this file as CommonJS. The app has no @types/node, so the Node
// APIs these tests need are declared here instead of pulling in a whole type
// package for one file.
declare const __dirname: string;

type FileSystem = {
  mkdirSync: (path: string, options: { recursive: true }) => void;
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string, options: { recursive: true; force: true }) => void;
  writeFileSync: (path: string, contents: string) => void;
};

type Crypto = {
  createHash: (algorithm: string) => {
    update: (data: Uint8Array) => { digest: (encoding: "hex") => string };
  };
};

type FontAsset = { file: string; urlPath: string; hash: string };

type RequiredFont = { file: string; what: string; sources: string[] };

type LaunchAsset = { platform: string; url: string; urlPath: string };

type ServerAnswer = {
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
};

type FontCheck = {
  bundleFontAssets: (bundle: string) => Map<string, FontAsset>;
  deliveryProblems: (asset: FontAsset, answer: ServerAnswer) => string[];
  emissionProblems: (input: {
    fonts: RequiredFont[];
    platforms: { platform: string; assets: Map<string, FontAsset> }[];
    fileExists: (urlPath: string) => boolean;
  }) => {
    required: { platform: string; font: RequiredFont; asset: FontAsset }[];
    problems: string[];
  };
  builtManifests: (root: string) => { platform: string; file: string }[];
  deploymentOrigin: (env: Record<string, string | undefined>) => string | null;
  launchAssets: (input: {
    platforms: string[];
    readManifest: (platform: string) => string | null;
    bundlePaths: (platform: string) => string[];
    expectedOrigin: string;
  }) => { launches: LaunchAsset[]; problems: string[] };
  launchProblems: (launch: LaunchAsset, answer: ServerAnswer) => string[];
  manifestLaunchAsset: (
    platform: string,
    text: string,
    expectedOrigin: string | null,
  ) => { launch?: LaunchAsset; problem?: string };
  readServed: (
    origin: string,
    urlPath: string,
    fetchImpl: (url: string) => Promise<unknown>,
  ) => Promise<ServerAnswer>;
  servedUrlPath: (root: string, file: string, basePath: string) => string;
  requiredFonts: (root?: string) => {
    fonts: RequiredFont[];
    problems: string[];
  };
  staticFilePath: (root: string, urlPath: string, basePath: string) => string;
  TAB_LAYOUT: string;
};

const fs: FileSystem = require("node:fs");
const os: { tmpdir: () => string } = require("node:os");
const crypto: Crypto = require("node:crypto");

const check: FontCheck = require("../scripts/check-fonts.cjs");

const APP_ROOT = `${__dirname}/..`;

/* ---------------------------------------------------------------------------
 * Throwaway app trees, so a test can describe an app this one is not.
 * ------------------------------------------------------------------------ */

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  temporaryRoots.length = 0;
});

function workspace(files: Record<string, string>): string {
  const root = fs.mkdtempSync(`${os.tmpdir()}/chat-app-fonts-`);
  temporaryRoots.push(root);

  for (const [relative, contents] of Object.entries(files)) {
    const lastSlash = relative.lastIndexOf("/");
    if (lastSlash !== -1) {
      fs.mkdirSync(`${root}/${relative.slice(0, lastSlash)}`, {
        recursive: true,
      });
    }
    fs.writeFileSync(`${root}/${relative}`, contents);
  }
  return root;
}

/** An installed @expo/vector-icons with one family in it. */
function iconPackage(family: string, fontFile: string | null) {
  const module =
    fontFile === null
      ? `import createIconSet from './createIconSet';\nexport default createIconSet({}, '${family}');\n`
      : `import createIconSet from './createIconSet';\nimport font from './vendor/react-native-vector-icons/Fonts/${fontFile}';\nexport default createIconSet({}, '${family}', font);\n`;

  return {
    "node_modules/@expo/vector-icons/package.json": '{"name":"@expo/vector-icons"}',
    [`node_modules/@expo/vector-icons/build/${family}.js`]: module,
  };
}

/** An installed @expo-google-fonts/inter exporting the given names. */
function textFontPackage(exports: Record<string, string>) {
  const lines = Object.entries(exports).map(
    ([name, file]) => `export const ${name} = require('./${file}');`,
  );
  return {
    "node_modules/@expo-google-fonts/inter/package.json":
      '{"name":"@expo-google-fonts/inter"}',
    "node_modules/@expo-google-fonts/inter/index.js": `export * from './useFonts';\n${lines.join("\n")}\n`,
  };
}

const TAB_BAR = `import { Feather } from "@expo/vector-icons";
export default function TabLayout() {
  return <Feather name="message-circle" size={24} />;
}
`;

const ROOT_LAYOUT = `import { useFonts, Inter_400Regular } from "@expo-google-fonts/inter";
export default function RootLayout() {
  useFonts({ Inter_400Regular });
}
`;

/* ---------------------------------------------------------------------------
 * The fonts the check decides the app needs
 * ------------------------------------------------------------------------ */

describe("the fonts the app loads", () => {
  it("names the file the tab bar's icons are drawn with", () => {
    const { fonts, problems } = check.requiredFonts();

    expect(problems).toEqual([]);

    const feather = fonts.find((font) => font.file === "Feather.ttf");
    // Resolved from @expo/vector-icons itself rather than assumed here, and
    // attributed to the layout whose icons this check exists for.
    expect(feather?.sources).toContain(check.TAB_LAYOUT);
    expect(feather?.what).toContain("Feather");
  });

  it("names every text font the app loads", () => {
    const { fonts } = check.requiredFonts();

    expect(fonts.map((font) => font.file)).toEqual([
      "Feather.ttf",
      "Inter_400Regular.ttf",
      "Inter_500Medium.ttf",
      "Inter_600SemiBold.ttf",
      "Inter_700Bold.ttf",
    ]);
    for (const font of fonts) {
      // A font nothing asks for would make the rest of the check meaningless.
      expect(font.sources.length).toBeGreaterThan(0);
    }
  });

  it("reads an app that draws and loads nothing else", () => {
    const root = workspace({
      "app/(tabs)/_layout.tsx": TAB_BAR,
      "app/_layout.tsx": ROOT_LAYOUT,
      ...iconPackage("Feather", "Feather.ttf"),
      ...textFontPackage({ Inter_400Regular: "400Regular/Inter_400Regular.ttf" }),
    });

    const { fonts, problems } = check.requiredFonts(root);

    expect(problems).toEqual([]);
    expect(fonts).toEqual([
      {
        file: "Feather.ttf",
        what: "the Feather icons",
        sources: ["app/(tabs)/_layout.tsx"],
      },
      {
        file: "Inter_400Regular.ttf",
        what: "the Inter_400Regular text font",
        sources: ["app/_layout.tsx"],
      },
    ]);
  });

  it("follows an icon family renamed on the way in", () => {
    const root = workspace({
      "app/(tabs)/_layout.tsx":
        'import { Feather as TabIcon } from "@expo/vector-icons";\n',
      "app/_layout.tsx": ROOT_LAYOUT,
      ...iconPackage("Feather", "Feather.ttf"),
      ...textFontPackage({ Inter_400Regular: "400Regular/Inter_400Regular.ttf" }),
    });

    const { fonts, problems } = check.requiredFonts(root);

    expect(problems).toEqual([]);
    expect(fonts.map((font) => font.file)).toContain("Feather.ttf");
  });

  it("refuses an icon family whose font file it cannot find", () => {
    const root = workspace({
      "app/(tabs)/_layout.tsx": TAB_BAR,
      ...iconPackage("Feather", null),
    });

    const { problems } = check.requiredFonts(root);

    // Silently dropping it would leave the tab icons uncovered while the check
    // still passed.
    expect(problems.join("\n")).toContain("app/(tabs)/_layout.tsx");
    expect(problems.join("\n")).toContain("could not find the font file");
  });

  it("refuses a font name the package no longer exports", () => {
    const root = workspace({
      "app/(tabs)/_layout.tsx": TAB_BAR,
      "app/_layout.tsx": ROOT_LAYOUT,
      ...iconPackage("Feather", "Feather.ttf"),
      ...textFontPackage({ Inter_400: "400Regular/Inter_400Regular.ttf" }),
    });

    const { problems } = check.requiredFonts(root);

    expect(problems.join("\n")).toContain("Inter_400Regular");
    expect(problems.join("\n")).toContain("exports no such name");
  });

  it("refuses an app whose tab bar draws no icons it can follow", () => {
    const root = workspace({
      "app/(tabs)/_layout.tsx": "export default function TabLayout() {}\n",
      "app/_layout.tsx": ROOT_LAYOUT,
      ...textFontPackage({ Inter_400Regular: "400Regular/Inter_400Regular.ttf" }),
    });

    const { fonts, problems } = check.requiredFonts(root);

    expect(fonts.map((font) => font.file)).toEqual(["Inter_400Regular.ttf"]);
    expect(problems.join("\n")).toContain("draws no icons");
  });

  it("refuses an app it found no font in at all", () => {
    const root = workspace({
      "app/(tabs)/_layout.tsx": "export default function TabLayout() {}\n",
    });

    const { fonts, problems } = check.requiredFonts(root);

    expect(fonts).toEqual([]);
    expect(problems.join("\n")).toContain("no font at all");
  });
});

/* ---------------------------------------------------------------------------
 * What a built bundle asks for
 * ------------------------------------------------------------------------ */

/** One asset registry entry, written the way the built bundle carries it. */
function assetEntry(
  location: string,
  hash: string,
  name: string,
  type: string,
): string {
  return `{__packager_asset:true,httpServerLocation:"${location}",width:0,height:0,scales:[1],hash:"${hash}",name:"${name}",type:"${type}"}`;
}

/** The location the build rewrites an asset to, relative segments and all. */
const BUILT_LOCATION =
  "https://app.example.dev/1790444887337-223/_expo/static/js/./../../node_modules/.pnpm/@expo+vector-icons@15.1.1/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts";

describe("the fonts a built bundle asks for", () => {
  it("asks for them at the path the client resolves, not the one written", () => {
    const assets = check.bundleFontAssets(
      assetEntry(BUILT_LOCATION, "ca4b48e0", "Feather", "ttf"),
    );

    // The build leaves the `./../..` of the path the asset was relative to in
    // the URL; every client folds it away before asking, and so must a check
    // that claims to ask the same question.
    expect(assets.get("Feather.ttf")).toEqual({
      file: "Feather.ttf",
      hash: "ca4b48e0",
      urlPath:
        "/1790444887337-223/_expo/node_modules/.pnpm/@expo+vector-icons@15.1.1/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf",
    });
  });

  it("reads a location left as a plain path", () => {
    const assets = check.bundleFontAssets(
      assetEntry("/assets/fonts", "abc123", "Inter_400Regular", "ttf"),
    );

    expect(assets.get("Inter_400Regular.ttf")?.urlPath).toBe(
      "/assets/fonts/Inter_400Regular.ttf",
    );
  });

  it("reads every font in the bundle and nothing that is not one", () => {
    const assets = check.bundleFontAssets(
      [
        assetEntry("/assets/images", "img1", "icon", "png"),
        assetEntry("/assets/fonts", "f1", "Feather", "ttf"),
        assetEntry("/assets/fonts", "f2", "Inter_700Bold", "otf"),
        assetEntry("/assets/fonts", "f3", "Inter_400Regular", "woff2"),
      ].join(","),
    );

    expect([...assets.keys()].sort()).toEqual([
      "Feather.ttf",
      "Inter_400Regular.woff2",
      "Inter_700Bold.otf",
    ]);
  });

  it("finds no font in a bundle that carries none", () => {
    expect(check.bundleFontAssets("var x = 1;").size).toBe(0);
  });
});

describe("where a requested font lands in the build output", () => {
  it("looks under the build output for the path the app requests", () => {
    expect(check.staticFilePath("/app", "/123/_expo/Feather.ttf", "")).toBe(
      "/app/static-build/123/_expo/Feather.ttf",
    );
  });

  it("drops the base path the server itself strips", () => {
    // The build bakes BASE_PATH into every asset URL and server/serve.js takes
    // it back off; a check reading the URL has to do the same or it looks for
    // a directory named after the deployment.
    expect(
      check.staticFilePath("/app", "/chat/123/_expo/Feather.ttf", "/chat"),
    ).toBe("/app/static-build/123/_expo/Feather.ttf");
  });

  it("names the path a file in the output is served at, base path and all", () => {
    // The other direction, for comparing what the build wrote against what a
    // manifest tells a client to ask for.
    expect(
      check.servedUrlPath(
        "/app",
        "/app/static-build/123/_expo/static/js/ios/bundle.js",
        "/chat",
      ),
    ).toBe("/chat/123/_expo/static/js/ios/bundle.js");
    expect(
      check.servedUrlPath("/app", "/app/static-build/123/bundle.js", ""),
    ).toBe("/123/bundle.js");
  });
});

/* ---------------------------------------------------------------------------
 * What the build left out
 * ------------------------------------------------------------------------ */

const FEATHER: RequiredFont = {
  file: "Feather.ttf",
  what: "the Feather icons",
  sources: ["app/(tabs)/_layout.tsx"],
};

const featherAsset: FontAsset = {
  file: "Feather.ttf",
  urlPath: "/123/_expo/Feather.ttf",
  hash: "ca4b48e0",
};

describe("what the build left out", () => {
  it("passes a font the bundle asks for and the build wrote", () => {
    const { required, problems } = check.emissionProblems({
      fonts: [FEATHER],
      platforms: [{ platform: "ios", assets: new Map([["Feather.ttf", featherAsset]]) }],
      fileExists: () => true,
    });

    expect(problems).toEqual([]);
    expect(required).toEqual([
      { platform: "ios", font: FEATHER, asset: featherAsset },
    ]);
  });

  it("reports a platform whose bundle stopped carrying the font", () => {
    const { required, problems } = check.emissionProblems({
      fonts: [FEATHER],
      platforms: [
        { platform: "android", assets: new Map() },
        { platform: "ios", assets: new Map([["Feather.ttf", featherAsset]]) },
      ],
      fileExists: () => true,
    });

    // One platform shipping it is not the app shipping it.
    expect(problems.join("\n")).toContain("the android bundle carries no asset");
    expect(required).toHaveLength(1);
  });

  it("reports an asset the build never wrote a file for", () => {
    const { required, problems } = check.emissionProblems({
      fonts: [FEATHER],
      platforms: [{ platform: "ios", assets: new Map([["Feather.ttf", featherAsset]]) }],
      fileExists: () => false,
    });

    expect(problems.join("\n")).toContain("but the build wrote no such file");
    expect(required).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * What the manifests point at
 * ------------------------------------------------------------------------ */

/** A manifest the way scripts/build.js writes one, launch asset and all. */
function manifest(launchAsset: unknown): string {
  return JSON.stringify(
    { id: "7b15cbda", runtimeVersion: "exposdk:54.0.0", launchAsset, assets: [] },
    null,
    2,
  );
}

const ORIGIN = "https://app.example.dev";

const IOS_BUNDLE_URL = `${ORIGIN}/chat/1790444887337-223/_expo/static/js/ios/bundle.js`;

describe("the code a manifest sends a client to download", () => {
  it("asks for the path of the absolute URL the build baked in", () => {
    const read = check.manifestLaunchAsset(
      "ios",
      manifest({
        key: "bundle-1790444887337-223",
        contentType: "application/javascript",
        url: IOS_BUNDLE_URL,
      }),
      ORIGIN,
    );

    // The base path stays on: the build bakes it into the URL and
    // server/serve.js takes it back off, exactly as it does for a font.
    expect(read.problem).toBeUndefined();
    expect(read.launch).toEqual({
      platform: "ios",
      url: IOS_BUNDLE_URL,
      urlPath: "/chat/1790444887337-223/_expo/static/js/ios/bundle.js",
    });
  });

  it("reports a manifest that names no launch asset at all", () => {
    const { problem } = check.manifestLaunchAsset("android", manifest({}), ORIGIN);

    // A client reads this before anything else; with no URL in it there is
    // nothing for it to run.
    expect(problem).toContain("android");
    expect(problem).toContain("names no launch asset");
  });

  it("reports a manifest whose launch asset lost its URL", () => {
    const { problem } = check.manifestLaunchAsset(
      "ios",
      manifest({ key: "bundle-1790444887337-223", url: "" }),
      ORIGIN,
    );

    expect(problem).toContain("names no launch asset");
  });

  it("reports a manifest pointing a phone at a host that is not this app", () => {
    const { problem, launch } = check.manifestLaunchAsset(
      "ios",
      manifest({ url: "https://somewhere.else/123/_expo/static/js/ios/bundle.js" }),
      ORIGIN,
    );

    // Nothing this check serves locally would ever hear about this: the phone
    // goes to the host in the URL, and that host is not the published app.
    expect(launch).toBeUndefined();
    expect(problem).toContain("https://somewhere.else");
    expect(problem).toContain(ORIGIN);
  });

  it("reports a launch asset that is not an absolute URL", () => {
    const { problem } = check.manifestLaunchAsset(
      "android",
      manifest({ url: "/123/_expo/static/js/android/bundle.js" }),
      ORIGIN,
    );

    expect(problem).toContain("not an absolute URL");
  });

  it("reports a manifest that is not readable JSON", () => {
    const { problem } = check.manifestLaunchAsset("ios", "<!doctype html>", ORIGIN);

    expect(problem).toContain("ios");
    expect(problem).toContain("not readable as JSON");
  });
});

describe("the domain the build publishes at", () => {
  it("prefers the internal app domain, then the dev domain, then the Expo one", () => {
    expect(
      check.deploymentOrigin({
        REPLIT_INTERNAL_APP_DOMAIN: "internal.example.dev",
        REPLIT_DEV_DOMAIN: "dev.example.dev",
        EXPO_PUBLIC_DOMAIN: "expo.example.dev",
      }),
    ).toBe("https://internal.example.dev");
    expect(
      check.deploymentOrigin({
        REPLIT_DEV_DOMAIN: "dev.example.dev",
        EXPO_PUBLIC_DOMAIN: "expo.example.dev",
      }),
    ).toBe("https://dev.example.dev");
    expect(check.deploymentOrigin({ EXPO_PUBLIC_DOMAIN: "expo.example.dev" })).toBe(
      "https://expo.example.dev",
    );
  });

  it("reads a domain given with a protocol on it, the way the build does", () => {
    expect(check.deploymentOrigin({ REPLIT_DEV_DOMAIN: "https://dev.example.dev/" })).toBe(
      "https://dev.example.dev",
    );
  });

  it("has nothing to compare against where no domain is named", () => {
    expect(check.deploymentOrigin({})).toBeNull();
  });
});

describe("the launch assets a build has to be checked for", () => {
  const bundleUrlPath = (platform: string) =>
    `/123/_expo/static/js/${platform}/bundle.js`;

  const readManifest = (platform: string) =>
    manifest({ url: `${ORIGIN}${bundleUrlPath(platform)}` });

  const bundlePaths = (platform: string) => [bundleUrlPath(platform)];

  it("reads one per platform the build wrote a bundle for", () => {
    const { launches, problems } = check.launchAssets({
      // The same platform appears once per build directory in the output.
      platforms: ["ios", "android", "ios"],
      readManifest,
      bundlePaths,
      expectedOrigin: ORIGIN,
    });

    expect(problems).toEqual([]);
    expect(launches.map((launch) => launch.platform)).toEqual(["android", "ios"]);
    expect(launches[1].urlPath).toBe(bundleUrlPath("ios"));
  });

  it("reports a platform the build wrote a bundle but no manifest for", () => {
    const { launches, problems } = check.launchAssets({
      platforms: ["android", "ios"],
      readManifest: (platform) => (platform === "ios" ? readManifest(platform) : null),
      bundlePaths,
      expectedOrigin: ORIGIN,
    });

    // Reading only the manifests that happen to be there would let a build
    // that stopped writing one shrink this check instead of failing it.
    expect(problems.join("\n")).toContain("static-build/android/manifest.json");
    expect(launches.map((launch) => launch.platform)).toEqual(["ios"]);
  });

  it("reports a platform the build wrote a manifest but no bundle for", () => {
    const { launches, problems } = check.launchAssets({
      platforms: ["android", "ios"],
      readManifest,
      bundlePaths: (platform) => (platform === "ios" ? bundlePaths(platform) : []),
      expectedOrigin: ORIGIN,
    });

    expect(problems.join("\n")).toContain(
      "the android manifest is in the output but the build wrote no android bundle",
    );
    expect(launches.map((launch) => launch.platform)).toEqual(["ios"]);
  });

  it("reports a manifest sending a client to another platform's bundle", () => {
    const { launches, problems } = check.launchAssets({
      platforms: ["android", "ios"],
      // What a build that lost the android bundle leaves behind if its
      // manifest is still written from the last one: a path the server
      // answers 200 for, carrying the code of the wrong platform.
      readManifest: (platform) =>
        platform === "android"
          ? manifest({ url: `${ORIGIN}${bundleUrlPath("ios")}` })
          : readManifest(platform),
      bundlePaths,
      expectedOrigin: ORIGIN,
    });

    expect(problems.join("\n")).toContain(
      `the android manifest sends a client to ${bundleUrlPath("ios")}`,
    );
    expect(launches.map((launch) => launch.platform)).toEqual(["ios"]);
  });
});

describe("the manifests the build wrote", () => {
  it("finds the one each platform directory holds", () => {
    const root = workspace({
      "static-build/ios/manifest.json": "{}",
      "static-build/android/manifest.json": "{}",
      // What the bundles and the tracked images sit in, neither of which is a
      // platform a client asks for a manifest as.
      "static-build/1790444887337-223/_expo/static/js/ios/bundle.js": "var x=1;",
      "static-build/og-image.png": "an image",
    });

    expect(check.builtManifests(root).map((found) => found.platform)).toEqual([
      "android",
      "ios",
    ]);
  });

  it("finds none where the build has never run", () => {
    expect(check.builtManifests(workspace({ "app/_layout.tsx": ROOT_LAYOUT }))).toEqual(
      [],
    );
  });
});

/* ---------------------------------------------------------------------------
 * What the server answered
 * ------------------------------------------------------------------------ */

/** Bytes that begin the way a TrueType file does. */
const TRUETYPE = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x14, 0x07, 0x09]);

const md5 = (bytes: Uint8Array): string =>
  crypto.createHash("md5").update(bytes).digest("hex");

const served = (asset: FontAsset, answer: Partial<ServerAnswer>): string[] =>
  check.deliveryProblems(asset, {
    status: 200,
    contentType: "font/ttf",
    bytes: TRUETYPE,
    ...answer,
  });

describe("what the server answered", () => {
  const asset: FontAsset = { ...featherAsset, hash: md5(TRUETYPE) };

  it("accepts the font arriving", () => {
    expect(served(asset, {})).toEqual([]);
  });

  it("reports a path the server has nothing for", () => {
    expect(served(asset, { status: 404, bytes: new Uint8Array() }).join("\n")).toContain(
      "answered 404",
    );
  });

  it("reports a font served as something other than a font", () => {
    // What server/serve.js answers for a file type its MIME table has no entry
    // for, which is how a dropped mapping shows up.
    expect(
      served(asset, { contentType: "application/octet-stream" }).join("\n"),
    ).toContain("not as a font");
  });

  it("accepts every font type the server knows", () => {
    for (const contentType of ["font/ttf", "font/otf", "font/woff2"]) {
      expect(served(asset, { contentType })).toEqual([]);
    }
  });

  it("reports an answer with no content type at all", () => {
    expect(served(asset, { contentType: null }).join("\n")).toContain(
      "no content type at all",
    );
  });

  it("reports an answer that is not a font file", () => {
    const html = new Uint8Array([0x3c, 0x21, 0x64, 0x6f]); // "<!do"
    expect(served(asset, { bytes: html }).join("\n")).toContain(
      "does not begin like a font file",
    );
  });

  it("reports an empty answer", () => {
    expect(served(asset, { bytes: new Uint8Array() }).join("\n")).toContain(
      "no bytes at all",
    );
  });

  it("reports a font whose bytes are not the ones the bundle asked for", () => {
    const other = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x99]);

    // Same format, different file: a stale or truncated copy draws the wrong
    // glyphs, or none.
    expect(served(asset, { bytes: other }).join("\n")).toContain(
      "answered with a different file",
    );
  });
});

const LAUNCH: LaunchAsset = {
  platform: "ios",
  url: IOS_BUNDLE_URL,
  urlPath: "/chat/1790444887337-223/_expo/static/js/ios/bundle.js",
};

const downloaded = (answer: Partial<ServerAnswer>): string[] =>
  check.launchProblems(LAUNCH, {
    status: 200,
    contentType: "application/javascript; charset=utf-8",
    bytes: new Uint8Array([0x76, 0x61, 0x72, 0x20]), // "var "
    ...answer,
  });

describe("what the server answered for the app's own code", () => {
  it("accepts the bundle arriving", () => {
    expect(downloaded({})).toEqual([]);
  });

  it("accepts either name a server gives JavaScript", () => {
    for (const contentType of ["application/javascript", "text/javascript"]) {
      expect(downloaded({ contentType })).toEqual([]);
    }
  });

  it("names the platform and what the server answered for a path it has nothing for", () => {
    const [problem] = downloaded({ status: 404, bytes: new Uint8Array() });

    // A renamed output directory or a changed base path arrives exactly here,
    // and whoever reads this has to know which platform stopped starting.
    expect(problem).toContain("ios cannot start");
    expect(problem).toContain("answered 404");
    expect(problem).toContain(LAUNCH.urlPath);
  });

  it("reports a bundle served as something other than JavaScript", () => {
    // What server/serve.js answers for a file type its MIME table has no entry
    // for, which is what a bundle written with another extension arrives as.
    expect(downloaded({ contentType: "application/octet-stream" }).join("\n")).toContain(
      "not as JavaScript",
    );
  });

  it("reports an answer with no content type at all", () => {
    expect(downloaded({ contentType: null }).join("\n")).toContain(
      "no content type at all",
    );
  });

  it("reports a 200 carrying nothing", () => {
    const problems = downloaded({ bytes: new Uint8Array() }).join("\n");

    expect(problems).toContain("ios cannot start");
    expect(problems).toContain("no bytes at all");
  });
});

describe("asking the server for a path the app requests", () => {
  it("asks for the path the bundle names and reads the bytes back", async () => {
    const asked: string[] = [];
    const answer = await check.readServed(
      "http://127.0.0.1:4321",
      featherAsset.urlPath,
      (url: string) => {
        asked.push(url);
        return Promise.resolve({
          status: 200,
          headers: { get: () => "font/ttf" },
          arrayBuffer: () => Promise.resolve(TRUETYPE.buffer),
        });
      },
    );

    expect(asked).toEqual(["http://127.0.0.1:4321/123/_expo/Feather.ttf"]);
    expect(answer).toEqual({
      status: 200,
      contentType: "font/ttf",
      bytes: TRUETYPE,
    });
  });
});

describe("the check's own wiring", () => {
  it("is the script the package runs", () => {
    const packageJson: { scripts: Record<string, string> } = require(
      `${APP_ROOT}/package.json`,
    );

    // A check nothing runs is a check that never fails.
    expect(packageJson.scripts["check:fonts"]).toBe(
      "node scripts/check-fonts.cjs",
    );
  });
});
