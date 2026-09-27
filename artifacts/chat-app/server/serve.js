/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res) {
  const manifest = STATIC_FILES.get(`/${platform}/manifest.json`);

  if (!manifest) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest.content);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  const pageDescription = `Get ${appName} on your phone: real-time code collaboration, calls, and chat for developers.`;
  const socialDescription =
    "Real-time collaboration for developers — code sandbox, calls, and chat.";

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName)
    .replace(/PAGE_DESCRIPTION_PLACEHOLDER/g, pageDescription)
    .replace(/SOCIAL_DESCRIPTION_PLACEHOLDER/g, socialDescription);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function resolveStaticPath(urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return { error: 400 };
  }

  if (decodedPath.includes("\0")) {
    return { error: 400 };
  }

  const pathSegments = decodedPath.replace(/\\/g, "/").split("/");
  if (pathSegments.includes("..")) {
    return { error: 403 };
  }

  const pathKey = `/${pathSegments.filter((segment) => segment && segment !== ".").join("/")}`;
  return { pathKey };
}

function serveStaticFile(urlPath, res) {
  const resolved = resolveStaticPath(urlPath);
  if ("error" in resolved) {
    res.writeHead(resolved.error);
    res.end(resolved.error === 400 ? "Bad Request" : "Forbidden");
    return;
  }
  const staticFile = STATIC_FILES.get(resolved.pathKey);
  if (!staticFile) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  res.writeHead(200, { "content-type": staticFile.contentType });
  res.end(staticFile.content);
}

function loadStaticFiles(rootPath) {
  const files = new Map();

  function visit(directoryPath) {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(rootPath, absolutePath);
        const pathKey = `/${relativePath.split(path.sep).join("/")}`;
        const ext = path.extname(absolutePath).toLowerCase();
        files.set(pathKey, {
          content: fs.readFileSync(absolutePath),
          contentType: MIME_TYPES[ext] || "application/octet-stream",
        });
      }
    }
  }

  if (fs.existsSync(rootPath)) visit(rootPath);
  return files;
}

const STATIC_FILES = loadStaticFiles(STATIC_ROOT);
const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const appName = getAppName();

function createStaticServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let pathname = url.pathname;

    if (basePath && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length) || "/";
    }

    if (pathname === "/status") {
      res.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (pathname === "/" || pathname === "/manifest") {
      const platform = req.headers["expo-platform"];
      if (platform === "ios" || platform === "android") {
        return serveManifest(platform, res);
      }

      if (pathname === "/") {
        return serveLandingPage(req, res, landingPageTemplate, appName);
      }
    }

    serveStaticFile(pathname, res);
  });
}

const port = parseInt(process.env.PORT || "3000", 10);
if (require.main === module) {
  createStaticServer().listen(port, "0.0.0.0", () => {
    console.log(`Serving static Expo build on port ${port}`);
  });
}

module.exports = { createStaticServer, resolveStaticPath };
