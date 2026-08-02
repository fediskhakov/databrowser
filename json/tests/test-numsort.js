/* Unit tests for numeric-column detection and facet value ordering, sliced out of
   the page: numeric columns order by value, everything else by count. */
const { slice, fixture } = require("./lib.js");

const src = [
  "const bare = () => Object.create(null);",
  "const state = {scalarFields: [], values: {}, fieldLen: {}, fieldNum: {}};",
  "const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]+/g,'_');",
  "const URL_TEXT_MAX = 20;",
  slice("const IMG_EXT=", "return isImageURL(s) || (key!=null && IMG_NAME.test(normKey(key)) && isURL(s));\n}"),
  slice("const LONG_TEXT=", 'return t.length<=PEEK ? t : t.slice(0,PEEK).replace(/\\s+\\S*$/,"")+"…";\n};'),
  slice("/* Commonest value first", "return a.toLowerCase()<b.toLowerCase()?-1:1;\n}"),
  "module.exports = {state, measureFields, sortVals, isNumericField, isNumVal};"
].join("\n");

const mod = { exports: {} };
new Function("module", src)(mod);
const { state, measureFields, sortVals, isNumericField, isNumVal } = mod.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if(c) pass++; else { fail++; console.log("  FAIL " + m); } };

/* build a column from a list of raw values, exactly as the page does */
function column(vals){
  state.scalarFields = ["f"];
  const m = new Map();
  for(const v of vals){ const s = String(v); m.set(s, (m.get(s) || 0) + 1); }
  state.values = {f: m};
  measureFields();
  return [...m.entries()];
}
const order = vals => sortVals(column(vals), "f").map(e => e[0]);

console.log("\n== what counts as a number ==");
ok(isNumVal("42") && isNumVal("-3") && isNumVal("+7"), "integers, signed or not");
ok(isNumVal("3.14") && isNumVal(".5") && isNumVal("2."), "decimals, including bare leading/trailing points");
ok(isNumVal("1e6") && isNumVal("2.5E-3"), "scientific notation");
ok(isNumVal("  17  "), "surrounding whitespace is ignored");
ok(!isNumVal("2020 Census"), "a label that merely STARTS with digits is not a number");
ok(!isNumVal("45%") && !isNumVal("$30") && !isNumVal("1,234"), "nor are percentages, currency, or grouped digits");
ok(!isNumVal("") && !isNumVal("NaN") && !isNumVal("-"), "nor blanks, NaN, or a lone sign");

console.log("\n== which columns are treated as numeric ==");
const numeric = vals => { column(vals); return isNumericField("f"); };
ok(numeric([1998, 2003, 2019]), "a column of integers");
ok(numeric([2.82, 3.16, -0.5]), "a column of decimals and negatives");
ok(!numeric(["Harvard", "MIT", "Yale"]), "a column of names is not");
ok(!numeric(["2020 Census", "2010 Census", "1999 Survey"]), "nor are digit-leading labels");
ok(!numeric([5]), "a single distinct value is left alone — nothing to order");
ok(numeric([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "n/a"]),
   "one junk value among ten numbers still reads as a scale (90% of distinct values)");
ok(!numeric([1, 2, 3, 4, 5, 6, 7, "n/a", "unknown", "tbd"]),
   "but a third of them junk does not");
ok(!numeric(["12", "unknown", "unknown", "unknown", "unknown", "unknown"]),
   "judged on DISTINCT values, not record counts: mostly-text stays text");

console.log("\n== numeric columns order by value, ascending ==");
ok(JSON.stringify(order([10, 10, 10, 2, 2, 9, 1])) === '["1","2","9","10"]',
   "smallest first regardless of how common each is (10 is the commonest here)");
ok(JSON.stringify(order([100, 25, 3])) === '["3","25","100"]',
   "and numerically, not as text — 100 sorts after 25, where a string sort would flip them");
ok(JSON.stringify(order([-5, 0, 3.5, -12])) === '["-12","-5","0","3.5"]', "negatives and decimals land correctly");
ok(JSON.stringify(order([2, 1, 1, 1, "n/a", 3, 4, 5, 6, 7, 8, 9, 10, 11])).endsWith('"n/a"]'),
   "a stray non-numeric label sits after the scale rather than interrupting it");

console.log("\n== everything else still orders by count, commonest first ==");
const cities = ["Paris", "Paris", "Paris", "Oslo", "Rome", "Rome"];
ok(JSON.stringify(order(cities)) === '["Paris","Rome","Oslo"]', "three, two, one");
ok(JSON.stringify(order(["b", "a", "c"])) === '["a","b","c"]',
   "equal counts fall back to the value, so the order is predictable");
ok(JSON.stringify(order(["2020 Census", "2020 Census", "1999 Survey"])) === '["2020 Census","1999 Survey"]',
   "digit-leading labels keep count order — this is the case the strict test protects");

console.log("\n== the bundled dataset ==");
const econ = fixture("econ_departments.json").departments;
const cols = {};
for(const k of [...new Set(econ.flatMap(r => Object.keys(r)))])
  cols[k] = econ.map(r => r[k]).filter(v => v !== undefined && v !== null && v !== "" && typeof v !== "object");
const verdict = {};
for(const k in cols) verdict[k] = numeric(cols[k]);
const num = Object.keys(verdict).filter(k => verdict[k]);
ok(num.includes("repec_score"), `repec_score is numeric (numeric columns: ${JSON.stringify(num)})`);
ok(!verdict.country && !verdict.name && !verdict.category, "country, name and category are not");
const scores = order(cols.repec_score).map(Number);
ok(scores.every((v, i) => i === 0 || scores[i - 1] <= v), "and its filter list comes out ascending");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
