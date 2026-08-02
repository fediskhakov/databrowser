/* The bits a suite must not hardcode: where the viewer and its fixtures are, where
   Chrome lives, and where to put Chrome's throwaway profile. Everything else stays
   inside the suite that needs it. */
const fs = require("fs"), os = require("os"), path = require("path");

const DIR = path.join(__dirname, "..");            // the json/ directory
const viewerPath = path.join(DIR, "json-browser.html");
const html = fs.readFileSync(viewerPath, "utf8");

/* Lift a run of source out of the page by its first and last line, so the unit
   suites test the shipped code itself rather than a copy that can drift. */
const slice = (a, b) => {
  const i = html.indexOf(a);
  if(i < 0) throw new Error("slice: start not found in json-browser.html: " + a.slice(0, 60));
  const j = html.indexOf(b, i);
  if(j < 0) throw new Error("slice: end not found after start: " + b.slice(0, 60));
  return html.slice(i, j + b.length);
};

const fixture = name => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));

/* Usual install locations, newest-looking first; $CHROME overrides for anything
   else (a Chrome Canary, a Puppeteer download, a distro package). */
const CHROME_CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium",
].filter(Boolean);

function chromeBin(){
  for(const c of CHROME_CANDIDATES) if(fs.existsSync(c)) return c;
  console.error("no Chrome or Chromium found — set $CHROME to the binary and re-run");
  process.exit(2);
}

/* A fresh profile per run: a shared one leaves a lock behind that makes the next
   run — or a concurrent suite — fail to start with no useful message. */
const profileDir = name => fs.mkdtempSync(path.join(os.tmpdir(), "json-browser-" + name + "-"));

module.exports = { DIR, viewerPath, html, slice, fixture, chromeBin, profileDir };
