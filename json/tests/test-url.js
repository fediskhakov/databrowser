/* Tests the URL writer and reader together, sliced out of the page and run against
   a stubbed history/location. */
const { slice } = require("./lib.js");

const src = [
  "const bare = () => Object.create(null);",
  "const isRec = r => !!r && typeof r==='object';",
  slice("function arrayCandidates(raw){", "\n}"),
  slice("const encQ =", "\n}"),                 // encQ, decQ and syncURL
  slice("function parseQuery(search){", "\n}"),
  "module.exports = {sync: syncURL, parse: parseQuery};"
].join("\n");

let captured = null;
const sandbox = {
  state: {
    raw: {departments: []}, recordKey: "departments", fileName: "d.json",
    fields: ["repec_id","world_rank","university","country_code","category","refs"],
    scalarFields: ["repec_id","world_rank","university","country_code","category"],
    filters: {}, clauses: [], hidden: new Set(), search: "", pageSize: 100, page: 0, sorts: [],
    viewMode: "cards", titleSel: null, subSel: null, imageSel: null, autoLink: true, restoring: false
  },
  history: { replaceState: (a, b, url) => { captured = url; } },
  location: { pathname: "/json-browser.html" }
};
const st = sandbox.state;
function reset(){
  for(const k of st.scalarFields) st.filters[k] = {vals: new Set(), missing: false, present: false};
  st.clauses = []; st.hidden.clear(); st.sorts = []; st.search = ""; st.page = 0;
  st.titleSel = null; st.subSel = null; st.imageSel = null;
}
reset();

const mod = { exports: {} };
new Function("module","state","history","location", src)(mod, st, sandbox.history, sandbox.location);
const { sync, parse } = mod.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if(c) pass++; else { fail++; console.log("  FAIL " + m); } };
const q = () => { sync(); return captured; };
const params = () => parse(q());

console.log("\n== packing: one parameter, however many values ==");
st.filters.country_code.vals.add("us"); st.filters.country_code.vals.add("uk"); st.filters.country_code.vals.add("de");
ok(q().includes("f.country_code=us,uk,de"), "values are comma-joined\n         got " + q());
ok((q().match(/f\.country_code/g) || []).length === 1, "the field name appears once, not once per value");
ok(params().many("f.country_code").join("|") === "us|uk|de", "and they come back in order");

reset();
for(const v of ["United States", "United Kingdom", "Canada", "France", "Italy"]) st.filters.university.vals.add(v);
ok(q().length < 120, `five values in ${q().length} characters\n         ${q()}`);
ok(q().includes("United+States,United+Kingdom"), "spaces stay + and commas separate");

console.log("\n== a comma inside a value ==");
reset();
st.filters.university.vals.add("Ecole, Paris"); st.filters.university.vals.add("MIT");
ok(q().includes("Ecole%2C+Paris,MIT"), "the value's own comma is encoded, the separator is not\n         got " + q());
ok(JSON.stringify(params().many("f.university")) === JSON.stringify(["Ecole, Paris", "MIT"]),
   "so it splits back into exactly two values, one of them containing a comma");

console.log("\n== flags name their fields instead of repeating =1 ==");
reset();
st.filters.world_rank.missing = true; st.filters.category.missing = true; st.filters.university.present = true;
ok(q().includes("m=world_rank,category"), "missing flags pack into one m=\n         got " + q());
ok(q().includes("p=university"), "and present flags into one p=");
ok(!q().includes("=1"), "with no =1 anywhere");

reset();
st.hidden.add("country_code"); st.hidden.add("category"); st.hidden.add("refs");
ok(q() === "?file=d.json&h=country_code,category,refs", "switched-off fields pack too\n         got " + q());
ok(JSON.stringify(params().many("h")) === JSON.stringify(["country_code","category","refs"]),
   "and read back as a list");

console.log("\n== saved sets keep their numbering ==");
reset();
const clause = terms => ({terms: terms.map(([k, v]) => [k, {
  vals: new Set(v.vals || []), missing: !!v.missing, present: !!v.present}])});
st.clauses = [clause([["country_code", {vals: ["us","uk"]}], ["category", {missing: true}]]),
              clause([["university", {present: true}]])];
st.filters.country_code.vals.add("ca");
const u = q();
ok(u.includes("f1.country_code=us,uk") && u.includes("m1=category"), "set 1 packs within itself\n         got " + u);
ok(u.includes("p2=university"), "set 2 keeps its own number");
ok(u.includes("f.country_code=ca"), "and the live set stays unprefixed");

console.log("\n== sort levels stay one per parameter ==");
reset();
st.sorts = [{k:"country_code",desc:false,last:false},{k:"category",desc:true,last:false},
            {k:"university",desc:false,last:true}];
ok(q().includes("sa=country_code&sd=category&sla=university"),
   "packing them would lose their order, so it is not done\n         got " + q());

console.log("\n== nothing set, nothing written ==");
reset();
ok(q() === "?file=d.json", "a bare view carries only the file: " + q());
st.imageSel = "";
ok(q() === "?file=d.json&img=", "explicit no-thumbnail is an empty value");

console.log("\n== round trip through odd characters ==");
reset();
st.fields.push("odd field&name=x"); st.hidden.add("odd field&name=x");
st.filters.category.vals.add("a=b&c"); st.filters.category.vals.add("100%");
st.search = "a,b";
const round = params();
ok(JSON.stringify(round.many("h")) === JSON.stringify(["odd field&name=x"]),
   "a field name with & and = survives\n         got " + q());
ok(JSON.stringify(round.many("f.category")) === JSON.stringify(["a=b&c","100%"]),
   "and so do values with & = and %");
ok(round.one("q") === "a,b", "a comma in the search text is not split");

console.log("\n== the old spelling still parses ==");
const oldLink = parse("?file=d.json&f.country_code=us&f.country_code=uk&m.world_rank=1&h.category=1&sort=x&desc=1");
ok(JSON.stringify(oldLink.many("f.country_code")) === JSON.stringify(["us","uk"]),
   "repeated parameters accumulate rather than the first winning");
ok(oldLink.one("m.world_rank") === "1" && oldLink.one("h.category") === "1", "per-field flags are readable");
ok(oldLink.one("sort") === "x" && oldLink.one("desc") === "1", "and so is the old sort spelling");

console.log("\n== a field literally named \"\" ==");
reset();
st.scalarFields.push(""); st.fields.push("");
st.filters[""] = {vals: new Set(["x"]), missing: false, present: false};
const empty = q();
ok(empty.includes("f.=x"), "its filter is written\n         got " + empty);
ok(JSON.stringify(parse(empty).many("f.")) === JSON.stringify(["x"]),
   "and read back, rather than silently dropped on reload");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
