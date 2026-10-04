const { resolveStaticPath } = require("./serve");
const fs = require("fs");
const path = require("path");

describe("static file path resolution", () => {
  it("keeps normal asset paths inside the static build directory", () => {
    const result = resolveStaticPath("/assets/app.js");

    expect(result).toEqual({ pathKey: "/assets/app.js" });
  });

  it.each([
    "/../app.json",
    "/%2e%2e/app.json",
    "/assets/../../server/serve.js",
  ])("rejects traversal path %s", (candidate) => {
    expect(resolveStaticPath(candidate)).toEqual({ error: 403 });
  });

  it("rejects malformed URL encoding", () => {
    expect(resolveStaticPath("/%E0%A4%A")).toEqual({ error: 400 });
  });

  it("keeps the owner copyright footer dynamic", () => {
    const template = fs.readFileSync(
      path.join(__dirname, "templates", "landing-page.html"),
      "utf8",
    );

    expect(template).toContain("© <span id=\"copyright-year\"></span> Lisa M Gorewit-Decker");
    expect(template).toContain("new Date().getFullYear()");
  });
});

describe("the images the landing page asks this server for", () => {
  // The server hands out whatever scripts/build.js wrote, and the build writes
  // the root of that output from public/. So an image the page names is only
  // ever answered if it is a file in there: anything else is a 404 in a
  // browser — a missing favicon, a missing touch icon, or a social card that
  // does not render when the page is shared.
  const template = fs.readFileSync(
    path.join(__dirname, "templates", "landing-page.html"),
    "utf8",
  );
  const referenced = [
    ...new Set(
      [
        ...template.matchAll(
          /BASE_URL_PLACEHOLDER\/([\w.-]+\.(?:png|ico|svg|jpe?g|webp))/g,
        ),
      ].map((match) => match[1]),
    ),
  ].sort();

  it("names images at all, so the checks below measure something", () => {
    expect(referenced.length).toBeGreaterThan(0);
  });

  it.each(referenced)("publishes %s", (file) => {
    expect(fs.existsSync(path.join(__dirname, "..", "public", file))).toBe(true);
  });
});