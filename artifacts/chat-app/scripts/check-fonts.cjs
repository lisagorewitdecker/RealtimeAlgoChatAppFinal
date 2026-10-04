/**
 * Release check: the published app can download its own code, and every font
 * it loads is emitted by the build and handed out by the server that serves
 * it.
 *
 * The app draws its tab icons with @expo/vector-icons and its text with the
 * Inter family, and both are font files rather than code: the bundle carries
 * an asset entry naming the URL the font is fetched from, and the running app
 * fetches it from there before it can draw a single glyph. Until it arrives,
 * @expo/vector-icons draws every icon as an empty box — which is exactly what
 * the published app would show where the Chats and Profile icons belong if a
 * build or serving change dropped the file.
 *
 * No other suite can see that. __tests__/WebTabBar.test.web.tsx renders the
 * tab bar the way a browser builds it and proves it asks for the right Feather
 * glyphs, but jest has no bundler, so there is no asset registry for
 * expo-font to load a font file from and the suite has to report the font as
 * already loaded (test-support/webTabBar.tsx explains why). Everything from
 * the asset registry onwards — the build emitting the file, and
 * server/serve.js answering for it — is therefore unmeasured, and a build that
 * stopped emitting the font would leave every suite green.
 *
 * So this check runs the real thing. It builds the app the way the published
 * service builds it (scripts/build.js, the `build` script the artifact's
 * production service runs), reads the built bundles for the asset entries the
 * app will request, and then serves the output through server/serve.js — the
 * `serve` script that same service runs — and fetches each font the way the
 * app does. A font has reached the published app when:
 *
 *   - the built bundle still carries an asset entry for it, so the app knows
 *     where to ask for it;
 *   - the file is in the build output, so there is something to serve;
 *   - the server answers that URL with 200 and a font content type, rather
 *     than 404 or the `application/octet-stream` it falls back to for a file
 *     type it has no mapping for;
 *   - the bytes it answers with are the font: their MD5 is the hash the
 *     bundle's own asset entry advertises, so a placeholder, an error page or
 *     a truncated copy fails here rather than on a phone.
 *
 * Which fonts to require is read from the app rather than listed here: the
 * icon families its sources import from @expo/vector-icons, and the font names
 * they import from @expo-google-fonts, each resolved to the file that package
 * actually ships. A font added to app/_layout.tsx is covered without touching
 * this file, and an import this check cannot resolve to a file fails it rather
 * than quietly shrinking what it covers.
 *
 * Before any of that happens on a phone, though, the client fetches the update
 * manifest the build wrote for its platform and downloads the bundle the
 * manifest's `launchAsset` names — the app's own code. That URL is absolute,
 * built at build time out of the domain in the environment, and answered by
 * the same static server. A renamed output directory, a changed base path, or
 * a build that writes the manifest without the bundle behind it does not
 * reach a user as two empty tab icons; it reaches them as an app that does not
 * start at all. So the same run reads each manifest the build wrote and, before
 * asking for a single font, checks that it names that platform's own bundle at
 * the domain the build was given — the host is the phone's business, not this
 * server's — and that the server hands that bundle out.
 *
 * Run it with `pnpm --filter @workspace/chat-app run check:fonts`.
 * __tests__/PublishedFonts.test.ts covers the reading and judging this file
 * does; only the build and the server are left to the run itself.
 */

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

/** Where scripts/build.js writes, and what server/serve.js hands out. */
const STATIC_BUILD = "static-build";

/** The layout whose icons this check exists for. */
const TAB_LAYOUT = "app/(tabs)/_layout.tsx";

/** The package the app's icons are drawn with. */
const ICON_PACKAGE = "@expo/vector-icons";

/** The scope the app's text fonts come from. */
const TEXT_FONT_SCOPE = "@expo-google-fonts/";

/** What the build writes each platform's update manifest as. */
const MANIFEST_FILE = "manifest.json";

/**
 * Directories holding nothing the build ships: dependencies, the build's own
 * output, and the suites and scripts that are not part of the app.
 */
const SKIPPED_DIRECTORIES = new Set([
  "__tests__",
  "assets",
  "docs",
  "node_modules",
  "scripts",
  "server",
  STATIC_BUILD,
  "test-support",
]);

/** Asset types that are a font, lower-cased as the asset registry writes them. */
const FONT_TYPES = new Set(["ttf", "otf", "woff", "woff2"]);

/** Content types that tell a client it is being handed a font. */
const FONT_CONTENT_TYPE = /^(?:font\/|application\/(?:x-)?font-|application\/vnd\.ms-fontobject)/i;

/** Content types that tell a client it is being handed JavaScript to run. */
const JAVASCRIPT_CONTENT_TYPE = /^(?:application|text)\/(?:x-)?javascript\b/i;

/** How a font file starts, by the format it is in. */
const FONT_SIGNATURES = [
  [0x00, 0x01, 0x00, 0x00], // TrueType
  [0x74, 0x72, 0x75, 0x65], // "true", TrueType on Apple platforms
  [0x74, 0x74, 0x63, 0x66], // "ttcf", a TrueType collection
  [0x4f, 0x54, 0x54, 0x4f], // "OTTO", OpenType with CFF outlines
  [0x77, 0x4f, 0x46, 0x46], // "wOFF"
  [0x77, 0x4f, 0x46, 0x32], // "wOF2"
];

/** Only the origin matters to `new URL`; every path read here is its own. */
const PLACEHOLDER_ORIGIN = "http://published.invalid";

const toPosix = (value) => value.split(path.sep).join("/");

/* -------------------------------------------------------------------------
 * What the app loads
 * ---------------------------------------------------------------------- */

/** Every source file the app ships, as project-relative paths. */
function listSources(root, directory = "") {
  const absolute = directory ? path.join(root, directory) : root;
  let entries;
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch {
    return []; // a directory that cannot be read ships nothing
  }

  const files = [];
  for (const entry of entries) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...listSources(root, relative));
      continue;
    }
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(relative);
  }
  return files.sort();
}

const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

/**
 * The names a source imports by name, under the name the package exports
 * them as: `import { Feather as Icon }` still loads the Feather font.
 */
function namedImports(source) {
  const imports = [];
  for (const match of source.matchAll(NAMED_IMPORT)) {
    const module = match[2];
    for (const entry of match[1].split(",")) {
      const text = entry.trim().replace(/^type\s+/, "");
      if (!text) continue;
      const exported = text.split(/\s+as\s+/)[0].trim();
      if (exported) imports.push({ name: exported, module });
    }
  }
  return imports;
}

/** Where one package is installed, or null where it is not installed at all. */
function packageDirectory(root, name) {
  try {
    return path.dirname(
      require.resolve(`${name}/package.json`, { paths: [root] }),
    );
  } catch {
    const fallback = path.join(root, "node_modules", ...name.split("/"));
    return fs.existsSync(fallback) ? fallback : null;
  }
}

/**
 * The font file one @expo/vector-icons family draws from. Each family is a
 * module of its own that imports its file out of the package's Fonts
 * directory, so the package is asked rather than the mapping being restated
 * here — a renamed file is then found rather than assumed.
 */
function iconFontFile(packageDir, family) {
  const module = path.join(packageDir, "build", `${family}.js`);
  let source;
  try {
    source = fs.readFileSync(module, "utf8");
  } catch {
    return null;
  }
  const match = /Fonts\/([^"']+\.(?:ttf|otf|woff2?))/i.exec(source);
  return match ? match[1] : null;
}

/**
 * Every font file an @expo-google-fonts package exports, by the name it
 * exports it as. The package's index binds each name to the file it requires,
 * which is what `useFonts` hands to expo-font.
 */
function textFontFiles(packageDir) {
  const files = new Map();
  let source;
  try {
    source = fs.readFileSync(path.join(packageDir, "index.js"), "utf8");
  } catch {
    return files;
  }
  for (const match of source.matchAll(
    /export\s+const\s+(\w+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g,
  )) {
    files.set(match[1], path.posix.basename(match[2]));
  }
  return files;
}

/**
 * The fonts the app loads, each with the file it is shipped as and the sources
 * that ask for it, plus anything this check could not read — an unresolvable
 * import is reported rather than dropped, or the check would shrink silently
 * as the app changes.
 *
 * @returns {{ fonts: Array<{file: string, what: string, sources: string[]}>,
 *             problems: string[] }}
 */
function requiredFonts(root = projectRoot) {
  const problems = [];
  /** @type {Map<string, {file: string, what: string, sources: Set<string>}>} */
  const fonts = new Map();
  const missingPackages = new Set();

  // Every source that draws an icon imports the same package; resolving it
  // once keeps a dozen identical lookups out of the run.
  const directories = new Map();
  const directoryOf = (name) => {
    if (!directories.has(name)) directories.set(name, packageDirectory(root, name));
    return directories.get(name);
  };

  const require_ = (file, what, source) => {
    const existing = fonts.get(file);
    if (existing) {
      existing.sources.add(source);
      return;
    }
    fonts.set(file, { file, what, sources: new Set([source]) });
  };

  /** Files whose icons came from the tab bar, so its coverage can be pinned. */
  const tabBarFonts = new Set();

  for (const source of listSources(root)) {
    const text = fs.readFileSync(path.join(root, source), "utf8");
    for (const { name, module } of namedImports(text)) {
      if (module === ICON_PACKAGE) {
        const packageDir = directoryOf(ICON_PACKAGE);
        if (!packageDir) {
          missingPackages.add(ICON_PACKAGE);
          continue;
        }
        const file = iconFontFile(packageDir, name);
        if (!file) {
          problems.push(
            `${source} draws with ${name} from ${ICON_PACKAGE}, but this check could not find the font file that family loads — ${ICON_PACKAGE}/build/${name}.js names none, so it can no longer tell which file has to reach the published app`,
          );
          continue;
        }
        require_(file, `the ${name} icons`, source);
        if (source === TAB_LAYOUT) tabBarFonts.add(file);
        continue;
      }

      if (!module.startsWith(TEXT_FONT_SCOPE)) continue;
      const packageDir = directoryOf(module);
      if (!packageDir) {
        missingPackages.add(module);
        continue;
      }
      const exported = textFontFiles(packageDir);
      if (exported.size === 0) {
        problems.push(
          `${source} loads fonts from ${module}, but this check found no font file exported by it, so it cannot tell which files have to reach the published app`,
        );
        continue;
      }
      // A package exports its loading hook and its metadata beside its fonts,
      // and both are named by convention (`useFonts`, `__metadata__`). Any
      // other name is meant to be a font, so one bound to no file is a
      // problem rather than something to skip.
      const file = exported.get(name);
      if (file) {
        require_(file, `the ${name} text font`, source);
      } else if (!/^use[A-Z]/.test(name) && !/^__/.test(name)) {
        problems.push(
          `${source} imports ${name} from ${module}, which exports no such name — this check cannot tell whether a font the app loads was renamed`,
        );
      }
    }
  }

  for (const name of [...missingPackages].sort()) {
    problems.push(
      `the app's sources import fonts from ${name}, which is not installed, so this check cannot tell which files have to reach the published app`,
    );
  }

  if (fonts.size === 0) {
    problems.push(
      "no font at all was found in the app's sources, so this check would pass without measuring anything — either the app stopped loading fonts or the reading in scripts/check-fonts.cjs no longer finds them",
    );
  } else if (tabBarFonts.size === 0) {
    problems.push(
      `${TAB_LAYOUT} draws no icons this check could find, so nothing here covers the tab icons it exists for — either the tab bar stopped using ${ICON_PACKAGE} or this check needs updating to follow it`,
    );
  }

  return {
    fonts: [...fonts.values()]
      .map(({ file, what, sources }) => ({
        file,
        what,
        sources: [...sources].sort(),
      }))
      .sort((left, right) => left.file.localeCompare(right.file)),
    problems,
  };
}

/* -------------------------------------------------------------------------
 * What the build emitted
 * ---------------------------------------------------------------------- */

/**
 * Every bundle the build wrote, one per platform the published app offers.
 * Each is read for the asset entries the app running it will request.
 */
function builtBundles(root = projectRoot) {
  const staticBuild = path.join(root, STATIC_BUILD);
  const bundles = [];
  let builds;
  try {
    builds = fs.readdirSync(staticBuild, { withFileTypes: true });
  } catch {
    return bundles;
  }
  for (const build of builds) {
    if (!build.isDirectory()) continue;
    const platforms = path.join(staticBuild, build.name, "_expo", "static", "js");
    let entries;
    try {
      entries = fs.readdirSync(platforms, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const bundle = path.join(platforms, entry.name, "bundle.js");
      if (entry.isDirectory() && fs.existsSync(bundle)) {
        bundles.push({ platform: entry.name, file: bundle });
      }
    }
  }
  return bundles.sort((left, right) =>
    left.platform.localeCompare(right.platform),
  );
}

/**
 * The asset registry entry every asset is compiled into, read the same way
 * scripts/build.js reads it to decide what to copy.
 */
const ASSET_ENTRY =
  /httpServerLocation:"([^"]+)"[^}]*hash:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g;

/**
 * The fonts one built bundle will ask for, by file name, each with the path it
 * asks for them at and the hash it says they have.
 *
 * The build rewrites every asset's location into the URL the published app
 * requests it at, and leaves the `./../..` of the path it was relative to in
 * it; `new URL` folds those away exactly as the client's own URL parsing does
 * before the request is sent.
 */
function bundleFontAssets(bundle) {
  const assets = new Map();
  for (const match of bundle.matchAll(ASSET_ENTRY)) {
    const [, location, hash, name, type] = match;
    if (!FONT_TYPES.has(type.toLowerCase())) continue;
    const file = `${name}.${type}`;
    if (assets.has(file)) continue;
    let urlPath;
    try {
      urlPath = new URL(`${location}/${file}`, PLACEHOLDER_ORIGIN).pathname;
    } catch {
      continue; // a location nothing can request is reported as missing below
    }
    assets.set(file, { file, urlPath, hash });
  }
  return assets;
}

/**
 * What the build left out, read per platform: a font with no asset entry is
 * one the app never asks for, and an entry with no file behind it is one the
 * server has nothing to answer with. Everything else is a font to request.
 *
 * @returns {{ required: Array<object>, problems: string[] }}
 */
function emissionProblems({ fonts, platforms, fileExists }) {
  const required = [];
  const problems = [];
  for (const { platform, assets } of platforms) {
    for (const font of fonts) {
      const asset = assets.get(font.file);
      if (!asset) {
        problems.push(
          `the ${platform} bundle carries no asset for ${font.file} (${font.what}), so the app never asks for it and draws without it`,
        );
        continue;
      }
      if (!fileExists(asset.urlPath)) {
        problems.push(
          `the ${platform} bundle asks for ${font.file} at ${asset.urlPath}, but the build wrote no such file under ${STATIC_BUILD}/`,
        );
        continue;
      }
      required.push({ platform, font, asset });
    }
  }
  return { required, problems };
}

/* -------------------------------------------------------------------------
 * What the manifests point at
 * ---------------------------------------------------------------------- */

/**
 * The update manifest the build wrote for each platform, found where
 * server/serve.js looks for one when a client asks: a platform directory of
 * its own in the build output.
 */
function builtManifests(root = projectRoot) {
  const staticBuild = path.join(root, STATIC_BUILD);
  const manifests = [];
  let entries;
  try {
    entries = fs.readdirSync(staticBuild, { withFileTypes: true });
  } catch {
    return manifests;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(staticBuild, entry.name, MANIFEST_FILE);
    if (fs.existsSync(file)) manifests.push({ platform: entry.name, file });
  }
  return manifests.sort((left, right) =>
    left.platform.localeCompare(right.platform),
  );
}

/**
 * The origin the build builds every absolute URL it bakes into the output
 * from — the manifests' launch assets included.
 *
 * scripts/build.js reads the same three variables in the same order and
 * publishes at `https://` that host, so this is the one host the URLs in the
 * output it just wrote can point at. A manifest naming any other is a phone
 * sent to download the app's code from somewhere that is not the app, which
 * no amount of asking this server would show.
 *
 * @returns {string|null} null where the environment names no domain at all,
 *   which is a build that cannot run rather than one to read.
 */
function deploymentOrigin(env = process.env) {
  const domain =
    env.REPLIT_INTERNAL_APP_DOMAIN || env.REPLIT_DEV_DOMAIN || env.EXPO_PUBLIC_DOMAIN;
  if (!domain || domain.trim() === "") return null;
  const withProtocol = /^https?:\/\//i.test(domain.trim())
    ? domain.trim()
    : `https://${domain.trim()}`;
  try {
    return `https://${new URL(withProtocol).host}`;
  } catch {
    return null;
  }
}

/**
 * The bundle one platform's update manifest sends a client to download, and
 * the path it asks the server for it at.
 *
 * A client reads this manifest before anything else and runs whatever
 * `launchAsset.url` hands back, so a manifest that names nothing — or names
 * something no client could request — is an app with no code to start from.
 * The URL is absolute, built at build time out of the domain the build was
 * given, and both halves of it have to be right: the host, because that is
 * where the phone goes and no server started here would ever hear about it,
 * and the path, because that is what this server has to answer.
 *
 * @returns {{launch: {platform: string, url: string, urlPath: string}}
 *           | {problem: string}}
 */
function manifestLaunchAsset(platform, text, expectedOrigin) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return {
      problem: `the ${platform} manifest is not readable as JSON (${error.message}), so the ${platform} client cannot even learn where its code is`,
    };
  }

  const url = manifest?.launchAsset?.url;
  if (typeof url !== "string" || url.trim() === "") {
    return {
      problem: `the ${platform} manifest names no launch asset to download, so the ${platform} client is told nothing to run and the app does not start`,
    };
  }

  let parsed;
  try {
    parsed = new URL(url); // absolute, as every URL the build bakes in is
  } catch {
    return {
      problem: `the ${platform} manifest points its launch asset at ${url}, which is not an absolute URL a client can request`,
    };
  }

  if (parsed.origin !== expectedOrigin) {
    return {
      problem: `the ${platform} manifest sends a client to ${parsed.origin} for its code, not to ${expectedOrigin} where this build publishes, so the phone asks a host that is not this app`,
    };
  }

  return { launch: { platform, url, urlPath: parsed.pathname } };
}

/**
 * The launch asset to ask the server for on each platform, and what stands in
 * the way where there is none to ask for.
 *
 * Which platforms those are is the caller's to say rather than this function's
 * to discover, because neither half of the output can name them alone: a
 * platform the build wrote a bundle for but no manifest is a client with
 * nothing to read, and a manifest whose bundle the build never wrote is a
 * client sent to download something that is not there. Both have to fail
 * rather than leave one fewer platform to check.
 *
 * The manifest also has to point at that platform's own bundle. Asking the
 * server for whatever path it names would answer 200 for another platform's
 * code just as happily, and a phone handed the wrong platform's bundle is no
 * better off than one handed none.
 *
 * @param {(platform: string) => string[]} input.bundlePaths where the build's
 *   bundles for one platform are served from, empty where it wrote none.
 * @returns {{launches: Array<object>, problems: string[]}}
 */
function launchAssets({ platforms, readManifest, bundlePaths, expectedOrigin }) {
  const launches = [];
  const problems = [];
  for (const platform of [...new Set(platforms)].sort()) {
    const text = readManifest(platform);
    if (typeof text !== "string") {
      problems.push(
        `the ${platform} bundle is in the output but there is no ${STATIC_BUILD}/${platform}/${MANIFEST_FILE}, so the ${platform} client has no manifest to read and never learns where its code is`,
      );
      continue;
    }
    const read = manifestLaunchAsset(platform, text, expectedOrigin);
    if (read.problem) {
      problems.push(read.problem);
      continue;
    }

    const written = bundlePaths(platform);
    if (written.length === 0) {
      problems.push(
        `the ${platform} manifest is in the output but the build wrote no ${platform} bundle under ${STATIC_BUILD}/, so the ${platform} client is sent to download code that was never produced`,
      );
      continue;
    }
    if (!written.includes(read.launch.urlPath)) {
      problems.push(
        `the ${platform} manifest sends a client to ${read.launch.urlPath}, which is not the ${platform} bundle this build wrote (${written.join(", ")}), so the ${platform} app would run someone else's code or none`,
      );
      continue;
    }

    launches.push(read.launch);
  }
  return { launches, problems };
}

/** Where one file in the build output is requested from the server. */
function servedUrlPath(root, file, basePath) {
  const relative = path.relative(path.join(root, STATIC_BUILD), file);
  return `${basePath}/${relative.split(path.sep).join("/")}`;
}

/** Where one requested path lands in the build output on disk. */
function staticFilePath(root, urlPath, basePath) {
  const withoutBase =
    basePath && urlPath.startsWith(basePath)
      ? urlPath.slice(basePath.length)
      : urlPath;
  return path.join(
    root,
    STATIC_BUILD,
    ...withoutBase.split("/").filter((segment) => segment !== ""),
  );
}

/* -------------------------------------------------------------------------
 * What the server answered
 * ---------------------------------------------------------------------- */

function startsWithSignature(bytes) {
  return FONT_SIGNATURES.some((signature) =>
    signature.every((byte, index) => bytes[index] === byte),
  );
}

function md5(bytes) {
  return createHash("md5").update(Buffer.from(bytes)).digest("hex");
}

/**
 * What is wrong with the answer the server gave for one font, read as the app
 * reads it: an answer that is not 200, is not typed as a font, or is not the
 * font's own bytes leaves the icons undrawn just as a missing file does.
 *
 * @returns {string[]} one line per problem, empty where the font arrived.
 */
function deliveryProblems(asset, answer) {
  const problems = [];
  if (answer.status !== 200) {
    problems.push(
      `the server answered ${answer.status} for ${asset.urlPath}, so the app never receives ${asset.file}`,
    );
    return problems; // nothing else about a non-answer is worth reading
  }

  const contentType = answer.contentType ?? "";
  if (!FONT_CONTENT_TYPE.test(contentType)) {
    problems.push(
      `the server serves ${asset.file} as ${contentType || "no content type at all"}, not as a font — server/serve.js answers application/octet-stream for a file type it has no mapping for, so a font in a format its MIME_TYPES table does not name arrives untyped`,
    );
  }

  if (answer.bytes.length === 0) {
    problems.push(`the server answered with no bytes at all for ${asset.file}`);
    return problems;
  }
  if (!startsWithSignature(answer.bytes)) {
    problems.push(
      `what the server answered with for ${asset.file} does not begin like a font file, so the app would be handed ${answer.bytes.length} bytes it cannot draw with`,
    );
    return problems;
  }
  const served = md5(answer.bytes);
  if (served !== asset.hash) {
    problems.push(
      `the server answered with a different file for ${asset.file}: the built bundle asks for the asset hashed ${asset.hash} and what came back hashes ${served}`,
    );
  }
  return problems;
}

/**
 * What is wrong with the answer the server gave for one platform's launch
 * asset, read as the client starting the app reads it: anything but a 200
 * carrying JavaScript leaves it with no code to run, so nothing about that
 * platform's app is drawn at all.
 *
 * @returns {string[]} one line per problem, empty where the bundle arrived.
 */
function launchProblems(launch, answer) {
  const problems = [];
  if (answer.status !== 200) {
    problems.push(
      `${launch.platform} cannot start: the server answered ${answer.status} for ${launch.urlPath}, the bundle the ${launch.platform} manifest sends a client to download`,
    );
    return problems; // nothing else about a non-answer is worth reading
  }

  const contentType = answer.contentType ?? "";
  if (!JAVASCRIPT_CONTENT_TYPE.test(contentType)) {
    problems.push(
      `${launch.platform} cannot start: the server serves ${launch.urlPath} as ${contentType || "no content type at all"}, not as JavaScript — server/serve.js answers application/octet-stream for a file type it has no mapping for, so a bundle written with another extension arrives as something a client will not run`,
    );
  }

  if (answer.bytes.length === 0) {
    problems.push(
      `${launch.platform} cannot start: the server answered 200 with no bytes at all for ${launch.urlPath}, so the client downloads an empty bundle`,
    );
  }

  return problems;
}

/**
 * Fetches one path the way the app asks the server that served it — for a
 * font it draws with, or for the bundle its manifest sends it to download.
 */
async function readServed(origin, urlPath, fetchImpl = fetch) {
  const response = await fetchImpl(`${origin}${urlPath}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes,
  };
}

/* -------------------------------------------------------------------------
 * The run
 * ---------------------------------------------------------------------- */

/** What a failure in each half of this check means, under its own heading. */

const FONTS_FAILED = {
  headline: "Fonts do not reach the published app",
  why: [
    "Why: the app draws its tab icons and its text with font files, which the",
    "bundle carries as assets it fetches from the server that served it. Until a",
    "font arrives @expo/vector-icons draws every icon as an empty box, so a build",
    "that stops emitting one — or a server that stops handing it out — reaches a",
    "user as two empty boxes where the Chats and Profile icons belong. No jest",
    "suite can see that: jest has no bundler, so __tests__/WebTabBar.test.web.tsx",
    "has to report the icon font as already loaded to render the bar at all.",
  ].join("\n"),
};

const LAUNCH_FAILED = {
  headline: "The published app cannot download its own code",
  why: [
    "Why: a client fetches the update manifest the build wrote for its platform",
    "before anything else, and downloads the bundle the manifest's launchAsset",
    "names to get the code it runs. That URL is absolute, built at build time",
    "from the domain in the environment, and answered by the same static server,",
    "so a renamed output directory, a changed base path or a build that writes",
    "the manifest without the bundle reaches a user as an app that does not",
    "start at all — no tab icons to be empty, no screen to draw them on.",
  ].join("\n"),
};

const NOTHING_MEASURED = {
  headline: "This check could not measure the published app",
  why: [
    "Why: this check builds the app the way the published service builds it and",
    "serves the output through server/serve.js, then asks that server for the",
    "bundle each platform's manifest sends a client to download and for every",
    "font the app loads. Without a build there is nothing to ask it for.",
  ].join("\n"),
};

function fail({ headline, why }, report) {
  console.error(`\n${headline}\n\n${report}\n\n${why}\n`);
  process.exitCode = 1;
}

function runBuild() {
  console.log("Building the app the way the published service builds it...");
  const result = spawnSync("pnpm", ["run", "build"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main() {
  const { fonts, problems } = requiredFonts();
  if (problems.length > 0) {
    fail(
      FONTS_FAILED,
      [
        "This check can no longer tell which fonts the published app needs:",
        "",
        ...problems.map((problem) => `  - ${problem}`),
        "",
        "It reads them from the app itself — the families its sources import from",
        `  ${ICON_PACKAGE} and the names they import from ${TEXT_FONT_SCOPE}* — so`,
        "  a change to how the app loads fonts has to be followed in",
        "  scripts/check-fonts.cjs before this check means anything again.",
      ].join("\n"),
    );
    return;
  }

  console.log(`${fonts.length} fonts the app loads have to reach it:`);
  for (const font of fonts) {
    console.log(`  ${font.file} — ${font.what} (${font.sources.join(", ")})`);
  }
  console.log("");

  // The build empties and rewrites the output directory, which holds nothing
  // but build output: everything the published site serves from its root is
  // copied out of public/ on the way past, so this check leaves no file of
  // anyone's behind it.
  const status = runBuild();
  if (status !== 0) {
    fail(
      NOTHING_MEASURED,
      [
        `The build exited with ${status}, so there is nothing to check.`,
        "",
        "  This check builds the app with the package's own `build` script, the",
        "  one the artifact's production service runs before serving it. The",
        "  build's own output is above; a build that cannot run here cannot",
        "  publish either.",
      ].join("\n"),
    );
    return;
  }

  const bundles = builtBundles();
  if (bundles.length === 0) {
    fail(
      NOTHING_MEASURED,
      [
        `The build reported success but wrote no bundle under ${STATIC_BUILD}/.`,
        "",
        "  The code the app starts from is a bundle, and every font it loads is",
        "  an asset of one, so with no bundle there is nothing to read and",
        "  nothing to serve. Either scripts/build.js stopped writing",
        "  <build>/_expo/static/js/<platform>/bundle.js, or this check needs",
        "  updating to look where it writes now.",
      ].join("\n"),
    );
    return;
  }

  // The base path decides everything the build wrote and everything the
  // server answers: the build bakes it into every URL and the server strips it
  // back off, so the check reads it once and lets both of them see the same
  // value.
  const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

  // What a client asks for first: the manifest the build wrote for its
  // platform, and the bundle that manifest sends it to download. Every
  // platform either half of the output names is read, so neither a manifest
  // written without its bundle nor a bundle written without its manifest can
  // leave this check with one fewer platform to ask about.
  const expectedOrigin = deploymentOrigin();
  if (!expectedOrigin) {
    fail(
      NOTHING_MEASURED,
      [
        "The environment names no domain to publish at, so there is nothing to",
        "check the URLs the build baked in against.",
        "",
        "  scripts/build.js reads REPLIT_INTERNAL_APP_DOMAIN, REPLIT_DEV_DOMAIN",
        "  or EXPO_PUBLIC_DOMAIN to build every absolute URL in its output and",
        "  refuses to run without one, so reaching this means the two no longer",
        "  agree on where the published app lives.",
      ].join("\n"),
    );
    return;
  }

  const manifestFiles = new Map(
    builtManifests().map(({ platform, file }) => [platform, file]),
  );
  const { launches, problems: unreadable } = launchAssets({
    platforms: [...bundles.map((bundle) => bundle.platform), ...manifestFiles.keys()],
    readManifest: (platform) => {
      const file = manifestFiles.get(platform);
      if (!file) return null; // reported as a platform with no manifest at all
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    bundlePaths: (platform) =>
      bundles
        .filter((bundle) => bundle.platform === platform)
        .map((bundle) => servedUrlPath(projectRoot, bundle.file, basePath)),
    expectedOrigin,
  });

  if (unreadable.length > 0) {
    fail(
      LAUNCH_FAILED,
      [
        `${unreadable.length} ${unreadable.length === 1 ? "platform the build publishes tells" : "platforms the build publishes tell"} a client nothing to run:`,
        "",
        ...unreadable.map((problem) => `  - ${problem}`),
        "",
        "  scripts/build.js writes one manifest per platform and points its",
        "  launchAsset at that platform's own bundle, at the domain the build was",
        "  given. A manifest missing, empty, pointing elsewhere, or pointing at a",
        "  bundle this build did not write is an app that cannot start there.",
      ].join("\n"),
    );
    return;
  }

  /** Every font each platform's bundle asks for, and where it asks for it. */
  const required = [];
  const missing = [];
  for (const { platform, file } of bundles) {
    const assets = bundleFontAssets(fs.readFileSync(file, "utf8"));
    for (const font of fonts) {
      const asset = assets.get(font.file);
      if (!asset) {
        missing.push(
          `the ${platform} bundle carries no asset for ${font.file} (${font.what}), so the app never asks for it and draws without it`,
        );
        continue;
      }
      const onDisk = staticFilePath(projectRoot, asset.urlPath, basePath);
      if (!fs.existsSync(onDisk)) {
        missing.push(
          `the ${platform} bundle asks for ${font.file} at ${asset.urlPath}, but the build wrote no such file under ${STATIC_BUILD}/`,
        );
        continue;
      }
      required.push({ platform, font, asset });
    }
  }

  if (missing.length > 0) {
    fail(
      FONTS_FAILED,
      [
        `The build did not emit ${missing.length} font${missing.length === 1 ? "" : "s"} the app loads:`,
        "",
        ...missing.map((problem) => `  - ${problem}`),
        "",
        "  scripts/build.js copies an asset for every entry in the built bundle's",
        "  asset registry, so a font missing here was either dropped from the",
        "  bundle or lost between the registry and the output directory.",
      ].join("\n"),
    );
    return;
  }

  // Required after the build: server/serve.js reads the whole output directory
  // once, as it is loaded, exactly as the published service does at startup.
  const { createStaticServer } = require(
    path.join(projectRoot, "server", "serve.js"),
  );
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const launched = [];
  const unstartable = [];
  const served = [];
  const undelivered = [];
  try {
    // In the order a client does it: the code it runs first, then the fonts
    // that code loads.
    for (const launch of launches) {
      const answer = await readServed(origin, launch.urlPath);
      const problems = launchProblems(launch, answer);
      if (problems.length > 0) {
        unstartable.push(...problems);
        continue;
      }
      launched.push({ launch, answer });
    }

    for (const { platform, font, asset } of required) {
      const answer = await readServed(origin, asset.urlPath);
      const problems = deliveryProblems(asset, answer);
      if (problems.length > 0) {
        undelivered.push(...problems.map((problem) => `${platform}: ${problem}`));
        continue;
      }
      served.push({ platform, font, asset, answer });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  if (unstartable.length > 0) {
    fail(
      LAUNCH_FAILED,
      [
        "server/serve.js does not hand out the code the build's manifests send a client to download:",
        "",
        ...unstartable.map((problem) => `  - ${problem}`),
        "",
        "  The paths above come from the manifests scripts/build.js just wrote,",
        "  requested from a server started from server/serve.js over the output of",
        "  that same build — the pair the artifact's production service runs. A",
        "  client that cannot download this never reaches the fonts.",
      ].join("\n"),
    );
    return;
  }

  if (undelivered.length > 0) {
    fail(
      FONTS_FAILED,
      [
        `server/serve.js does not hand out ${undelivered.length} font${undelivered.length === 1 ? "" : "s"} the built app asks it for:`,
        "",
        ...undelivered.map((problem) => `  - ${problem}`),
        "",
        "  The paths above are the ones the built bundle names, requested from a",
        "  server started from server/serve.js over the output the build just",
        "  wrote — the same pair the artifact's production service runs.",
      ].join("\n"),
    );
    return;
  }

  console.log(
    "\nEvery platform the build publishes can download the code its manifest names:",
  );
  for (const { launch, answer } of launched) {
    console.log(
      `  ${launch.platform.padEnd(8)} ${answer.status} ${answer.contentType} ${answer.bytes.length} bytes  ${launch.urlPath}`,
    );
  }

  console.log(
    `\nAll ${fonts.length} fonts the app loads reach it on every platform the build publishes:`,
  );
  for (const { platform, font, asset, answer } of served) {
    console.log(
      `  ${platform.padEnd(8)} ${font.file.padEnd(24)} ${answer.status} ${answer.contentType} ${answer.bytes.length} bytes  ${asset.urlPath}`,
    );
  }
}

module.exports = {
  bundleFontAssets,
  builtBundles,
  builtManifests,
  deliveryProblems,
  deploymentOrigin,
  emissionProblems,
  iconFontFile,
  launchAssets,
  launchProblems,
  listSources,
  manifestLaunchAsset,
  namedImports,
  readServed,
  requiredFonts,
  servedUrlPath,
  staticFilePath,
  textFontFiles,
  FONT_TYPES,
  ICON_PACKAGE,
  TAB_LAYOUT,
  TEXT_FONT_SCOPE,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nRelease check failed to run: ${error.message}\n`);
    process.exitCode = 1;
  });
}
