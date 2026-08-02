/* Unit tests for the sort comparators, sliced out of the page. */
const { slice } = require("./lib.js");

const src = [
  "const bare = () => Object.create(null);",
  'const COLLATOR = new Intl.Collator(undefined,{sensitivity:"base",numeric:true});',
  "const isRec = r => !!r && typeof r==='object';",
  "const isMissing = v => v===null || v===undefined || v===\"\";",
  "const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]+/g,'_');",
  slice("const NAME_FIELD=", "const lastWord = v => { const p=String(v).trim().split(/\\s+/); return p[p.length-1]; };"),
  slice("function cmpVals(a,b){", "\n}"),
  slice("function cmpRecords(x,y,k,desc,last){", "\n}"),
  "module.exports = {isNameField, lastWord, cmpVals, cmpRecords};"
].join("\n");

const mod = { exports: {} };
new Function("module", src)(mod);
const { isNameField, lastWord, cmpVals, cmpRecords } = mod.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if(c) pass++; else { fail++; console.log("  FAIL " + m); } };

console.log("\n== which field gets the last-word options ==");
["name", "Name", "NAME", " name "].forEach(k => ok(isNameField(k), "should qualify: " + JSON.stringify(k)));
["full_name", "author_name", "names", "surname", "nickname", "university", "id"]
  .forEach(k => ok(!isNameField(k), "should NOT qualify: " + k));

console.log("\n== lastWord ==");
[["Ada Lovelace", "Lovelace"], ["John von Neumann", "Neumann"], ["Madonna", "Madonna"],
 ["  Grace   Hopper  ", "Hopper"], ["Jean-Luc Picard", "Picard"], ["X", "X"],
 ["Ludwig van der Berg", "Berg"], ["Anne\tMarie\nSmith", "Smith"],
].forEach(([v, want]) => ok(lastWord(v) === want, `${JSON.stringify(v)} -> ${JSON.stringify(lastWord(v))}, want ${want}`));

console.log("\n== ordering by value ==");
const order = (vals, k = "name", desc = false, last = false) =>
  vals.map(v => ({[k]: v})).sort((x, y) => cmpRecords(x, y, k, desc, last)).map(r => r[k]);

const people = ["Alan Turing", "Ada Lovelace", "John Smith", "Grace Hopper",
                "John von Neumann", "Madonna", "Ann Smith", undefined];

ok(JSON.stringify(order(people)) === JSON.stringify(
   ["Ada Lovelace","Alan Turing","Ann Smith","Grace Hopper","John Smith","John von Neumann","Madonna",undefined]),
   "plain ascending is by the whole string: " + order(people).join(", "));

ok(JSON.stringify(order(people, "name", false, true)) === JSON.stringify(
   ["Grace Hopper","Ada Lovelace","Madonna","John von Neumann","Ann Smith","John Smith","Alan Turing",undefined]),
   "by last word: " + order(people, "name", false, true).join(", "));

const lastDesc = order(people, "name", true, true);
ok(JSON.stringify(lastDesc) === JSON.stringify(
   ["Alan Turing","John Smith","Ann Smith","John von Neumann","Madonna","Ada Lovelace","Grace Hopper",undefined]),
   "by last word, descending: " + lastDesc.join(", "));
ok(lastDesc[lastDesc.length - 1] === undefined, "the missing name stays last when reversed, not first");

const smiths = order(["John Smith", "Ann Smith", "Zoe Smith"], "name", false, true);
ok(JSON.stringify(smiths) === JSON.stringify(["Ann Smith", "John Smith", "Zoe Smith"]),
   "equal last words fall back to the whole name: " + smiths.join(", "));

console.log("\n== unchanged behaviour for ordinary fields ==");
ok(JSON.stringify(order([10, 9, 100, 1], "born")) === JSON.stringify([1, 9, 10, 100]), "numbers stay numeric");
ok(JSON.stringify(order(["10", "9", "100"], "born")) === JSON.stringify(["9", "10", "100"]), "numeric strings too");
ok(JSON.stringify(order(["item10", "item2"], "label")) === JSON.stringify(["item2", "item10"]), "digits inside text");
ok(JSON.stringify(order([true, false, true], "flag")) === JSON.stringify([false, true, true]), "false first");
ok(cmpVals("Ångström", "angstrom") === 0, "text compares accent- and case-insensitively");
ok(cmpRecords({a: null}, {a: "x"}, "a", false) === 1 && cmpRecords({a: null}, {a: "x"}, "a", true) === 1,
   "missing sorts last in both directions");
ok(cmpRecords({a: "x"}, {a: "x"}, "a", false) === 0, "ties return 0 so a stable sort keeps file order");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
