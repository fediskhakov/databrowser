/* Unit tests for long-text detection, sliced out of the page. */
const { slice, fixture } = require("./lib.js");

const src = [
  "const bare = () => Object.create(null);",
  "const isRec = r => !!r && typeof r==='object';",
  "const state = {scalarFields: [], values: {}, fieldLen: {}};",
  "const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]+/g,'_');",
  "const URL_TEXT_MAX = 20;",
  slice("const IMG_EXT=", "return isImageURL(s) || (key!=null && IMG_NAME.test(normKey(key)) && isURL(s));\n}"),
  slice("const LONG_TEXT=", 'return t.length<=PEEK ? t : t.slice(0,PEEK).replace(/\\s+\\S*$/,"")+"…";\n};'),
  "module.exports = {state, displayLen, measureFields, isLongText, textPeek, LONG_TEXT};"
].join("\n");

const mod = { exports: {} };
new Function("module", src)(mod);
const { state, displayLen, measureFields, isLongText, textPeek } = mod.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if(c) pass++; else { fail++; console.log("  FAIL " + m); } };

console.log("\n== displayLen: what a value actually prints ==");
ok(displayLen("Harvard University", "university") === 18, "plain text counts its characters");
ok(displayLen(1998, "year") === 4, "numbers count their digits");
ok(displayLen(null, "x") === 0 && displayLen(undefined, "x") === 0, "missing prints nothing");
ok(displayLen({a: 1}, "refs") === 0, "nested values are measured elsewhere");
ok(displayLen("https://www.economics.harvard.edu/faculty", "faculty_url") === 14,
   "a long URL collapses to a short label, so a column of URLs is not 'long text'");
ok(displayLen("http://ab.co/1234567", "u") === 20, "a short URL prints in full");
ok(displayLen("https://example.org/a.jpg", "photo") === 0, "an image is a thumbnail, not text");
ok(displayLen("data:image/png;base64," + "A".repeat(400), "logo") === 0, "nor is a base64 payload 400 characters of prose");
ok(displayLen("x".repeat(500), "abstract") === 500, "a real paragraph counts fully");

console.log("\n== which columns become expanders ==");
function classify(cols){
  state.scalarFields = Object.keys(cols);
  state.values = {};
  for(const k in cols){ const m = new Map();
    for(const v of cols[k]){ const s = String(v); m.set(s, (m.get(s) || 0) + 1); }
    state.values[k] = m; }
  measureFields();
  return state.scalarFields.filter(isLongText);
}
const sentence = "z".repeat(200), short = ["Ada", "Grace", "Alan"];
ok(JSON.stringify(classify({name: short, abstract: [sentence, sentence, sentence]})) === '["abstract"]',
   "a column of paragraphs does, a column of names does not");
ok(classify({a: ["x".repeat(160)]}).length === 0, "exactly 160 characters is still a row");
ok(classify({a: ["x".repeat(161)]}).length === 1, "161 tips it into an expander");
ok(classify({url: Array.from({length: 20}, (_, i) => "https://example.org/a/very/long/path/number/" + i)}).length === 0,
   "a column of long URLs stays rows — they print as short labels");
ok(classify({year: [1998, 2003, 2019], score: [2.82, 3.16]}).length === 0, "numbers never become expanders");

/* one long value among many short ones must not move the column */
const outlier = [...Array(19).fill("short note"), "y".repeat(900)];
ok(classify({note: outlier}).length === 0,
   "one freak value in a short column stays a row (90th percentile by record)");
const mostly = [...Array(19).fill("y".repeat(400)), "short"];
ok(classify({note: mostly}).length === 1, "but a column that is mostly long becomes an expander");

console.log("\n== the teaser beside the collapsed triangle ==");
ok(textPeek("A brief remark.") === "A brief remark.", "a short value shows in full");
const long = textPeek("We study identification of intergenerational mobility parameters when the linkage between parents and children is incomplete");
ok(long.length <= 71 && long.endsWith("…"), `a long one is cut at a word boundary: ${JSON.stringify(long)}`);
ok(!/\s…$/.test(long), "with no space before the ellipsis");
ok(textPeek("  ragged\n\n  whitespace   here  ") === "ragged whitespace here", "newlines and runs collapse to single spaces");

console.log("\n== the bundled datasets ==");
const econ = fixture("econ_departments.json").departments;
const ecols = {};
for(const k of [...new Set(econ.flatMap(r => Object.keys(r)))])
  ecols[k] = econ.map(r => r[k]).filter(v => v !== undefined && v !== null && v !== "");
ok(classify(ecols).length === 0, "econ_departments has no long-text column, so nothing changes for it");

const texty = fixture("text-test.json").records;
const tcols = {};
for(const k of [...new Set(texty.flatMap(r => Object.keys(r)))])
  tcols[k] = texty.map(r => r[k]).filter(v => v !== undefined && v !== null && v !== "");
ok(JSON.stringify(classify(tcols)) === '["abstract"]',
   "text-test: only `abstract` expands, and its long `note` outlier does not: " + JSON.stringify(classify(tcols)));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
