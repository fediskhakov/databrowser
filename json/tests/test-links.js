/* Headless test of the auto-linking layer: slices the relevant functions out of
   json-browser.html, runs them against a fake `state` and the bundled fixture. */
const lib = require("./lib.js");
const html = lib.html;

function slice(startMark, endMark, name){
  const a = html.indexOf(startMark);
  if(a < 0) throw new Error("start marker not found: " + name);
  const b = html.indexOf(endMark, a);
  if(b < 0) throw new Error("end marker not found: " + name);
  return html.slice(a, b + endMark.length);
}

const src = [
  "const bare = () => Object.create(null);",
  "const isRec = r => !!r && typeof r==='object';",
  slice("const esc = s =>", "\n", "esc"),
  "const isMissing = v => v===null || v===undefined || v===\"\";",
  "const valKey = v => (v===null||v===undefined) ? \"(null)\" : String(v);",
  "const state = {autoLink:true, linkPlan:{}, linkFields:{}, scalarFields:[], values:{}};",
  slice("const encPath = s =>", 'return key==null||key==="" ? "open link" : "open "+key;\n}', "linking"),
  slice("function renderValue(v,key){", "\n}", "renderValue"),
  slice("function renderScalar(v,key){", "\n}", "renderScalar"),
  slice("function renderObjLine(o,key){", "\n}", "renderObjLine"),
  "module.exports = {state, resolveLink, buildLinkPlan, renderValue, renderScalar, renderObjLine, LINKERS};"
].join("\n");

const mod = { exports: {} };
new Function("module", src)(mod);
const { state, resolveLink, buildLinkPlan, renderValue, renderScalar, renderObjLine, LINKERS } = mod.exports;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if(cond){ pass++; } else { fail++; console.log("  FAIL " + msg); } };
function url(v, k){ const h = resolveLink(v, k); return h ? h.url : null; }
function eq(v, k, want){
  const got = url(v, k);
  ok(got === want, `${JSON.stringify(v)} @ ${k}\n         got  ${got}\n         want ${want}`);
}

console.log("\n== resolvers: positive ==");
eq("10.1257/aer.20190623", "doi", "https://doi.org/10.1257/aer.20190623");
eq("doi:10.1093/qje/qjaa021", "doi", "https://doi.org/10.1093/qje/qjaa021");
eq("10.1257/aer.20190623", "whatever", "https://doi.org/10.1257/aer.20190623");   // self-identifying
eq("10.1002/(SICI)1099-1255(199709/10)12:5<517::AID-JAE457>3.0.CO;2-J", "doi",
   "https://doi.org/10.1002/(SICI)1099-1255(199709/10)12%3A5%3C517%3A%3AAID-JAE457%3E3.0.CO%3B2-J");
eq("0000-0002-1825-0097", "orcid", "https://orcid.org/0000-0002-1825-0097");
eq("orcid:0000-0002-1694-233x", "author", "https://orcid.org/0000-0002-1694-233X");
eq("arXiv:2101.03970", "arxiv", "https://arxiv.org/abs/2101.03970");
eq("arXiv:math.GT/0309136", "x", "https://arxiv.org/abs/math.GT/0309136");
eq("1706.03762", "arxiv_id", "https://arxiv.org/abs/1706.03762");
eq("PMC7092803", "pmcid", "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7092803/");
eq("pmc7092803", "x", "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7092803/");
eq("RePEc:edi:deharus", "repec_id", "https://edirc.repec.org/data/deharus.html");
eq("32109013", "pmid", "https://pubmed.ncbi.nlm.nih.gov/32109013/");
eq("00028282", "issn", "https://portal.issn.org/resource/ISSN/0002-8282");
eq("1533-6212", "ISSN", "https://portal.issn.org/resource/ISSN/1533-6212");
eq("978-0-262-03384-8", "isbn", "https://openlibrary.org/isbn/9780262033848");
eq("0691138569", "isbn", "https://openlibrary.org/isbn/0691138569");
eq("Q13371", "wikidata_qid", "https://www.wikidata.org/wiki/Q13371");
eq("python/cpython", "github_repo", "https://github.com/python/cpython");
eq("author@example.org", "email", "mailto:author@example.org");
eq("www.example.org/econ", "homepage", "https://www.example.org/econ");
eq("sub.example.ac.uk", "website", "https://sub.example.ac.uk");
eq("20.500.12345/6789", "handle", "https://hdl.handle.net/20.500.12345/6789");
eq("hdl:2027/mdp.39015012345678", "x", "https://hdl.handle.net/2027/mdp.39015012345678");
eq("0000 0001 2097 4740", "isni", "https://isni.org/isni/0000000120974740");
eq("102333412", "viaf_id", "https://viaf.org/viaf/102333412");
eq("649DEF34F8BE52C8B66281AF98AE884C09AEF38B", "s2_paper",
   "https://www.semanticscholar.org/paper/649def34f8be52c8b66281af98ae884c09aef38b");
eq("13756489", "corpus_id", "https://api.semanticscholar.org/CorpusID:13756489");
eq("3623380", "ssrn_id", "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3623380");
eq("W2741809807", "openalex_id", "https://openalex.org/W2741809807");
eq("03vek6s52", "ror", "https://ror.org/03vek6s52");
eq("  10.3982/ECTA14231  ", "doi", "https://doi.org/10.3982/ECTA14231");            // trimmed

console.log("\n== resolvers: must stay plain ==");
[["1998","year"], ["12345678","count"], ["us","country_code"],
 ["see 10.1257 for details","note"], ["10.foo/bar","doi"], ["W12","internal_id"],
 ["0abcdefgh","code"], ["0000000000","code"], ["Q13371","label"], ["12345678","internal_id"],
 ["1706.03762","version"], ["W2741809807","some_field"], ["03vek6s52","some_field"],
 ["0000-0002-1825-009","note"], ["python/cpython","path"], ["author@example.org","author"],
 ["www.example.org","note"], ["123","isbn"], ["0000 0001 2097","isni"], ["",  "doi"],
 ["10.1257/" + "x".repeat(400), "doi"]
].forEach(([v,k]) => eq(v, k, null));

console.log("\n== field plan (90% of distinct values) ==");
const fixture = lib.fixture("link-test.json");
const recs = fixture.records;
const nonScalar = new Set(), fields = [];
for(const r of recs) for(const k in r){
  if(!fields.includes(k)) fields.push(k);
  const v = r[k]; if(v !== null && typeof v === "object") nonScalar.add(k);
}
state.scalarFields = fields.filter(k => !nonScalar.has(k));
state.values = {};
for(const k of state.scalarFields){
  const m = new Map();
  for(const r of recs){ const v = r[k]; if(!isMissingV(v)) m.set(String(v), (m.get(String(v))||0)+1); }
  state.values[k] = m;
}
function isMissingV(v){ return v===null || v===undefined || v===""; }
buildLinkPlan();
console.log("  plan:", JSON.stringify(state.linkPlan));
ok(state.linkPlan.id === "openalex", "field `id` (5/5 OpenAlex) should be promoted");
ok(!("almost_id" in state.linkPlan), "field `almost_id` (5/6) must NOT be promoted");
ok(!("mixed_id" in state.linkPlan), "field `mixed_id` (1/5) must NOT be promoted");
ok(!("code" in state.linkPlan), "field `code` (1/3 ROR-shaped) must NOT be promoted");
ok(!("internal_id" in state.linkPlan), "field `internal_id` must NOT be promoted");
ok(!("year" in state.linkPlan) && !("count" in state.linkPlan), "numeric fields must NOT be promoted");
eq("W2741809807", "id", "https://openalex.org/W2741809807");        // promoted column links
eq("W2741809807", "mixed_id", null);                                // unpromoted column does not
for(const f of ["doi","orcid","arxiv","arxiv_id","pmid","pmcid","issn","isbn","openalex_id",
                "ror","wikidata_qid","repec_id","github_repo","email","homepage","website",
                "ssrn_id","corpus_id","s2_paper","viaf_id","isni","handle","hdl","id"])
  ok(f in state.linkFields, "linkFields should report `" + f + "`");
for(const f of ["year","count","country_code","note","internal_id","code","mixed_id","almost_id","name"])
  ok(!(f in state.linkFields), "linkFields must not report `" + f + "`");
console.log("  reported:", Object.keys(state.linkFields).map(k=>k+"="+state.linkFields[k]).join(", "));

console.log("\n== rendering ==");
const doiCell = renderScalar("10.1257/aer.20190623", "doi");
ok(/class="vlink"/.test(doiCell), "auto-link carries the shared link class");
ok(doiCell.includes('title="DOI → https://doi.org/10.1257/aer.20190623"'), "tooltip names resolver + target");
ok(doiCell.endsWith(">10.1257/aer.20190623</a>"), "displayed text is the raw value, not the URL");
ok(doiCell.includes('rel="noopener noreferrer"'), "rel is hardened");
const verbatim = renderScalar("https://ex.org", "homepage");                       // 14 chars
ok(/class="vlink"/.test(verbatim) && verbatim.includes('href="https://ex.org"'),
   "data URLs carry the same class, so they look identical to resolved ones");
ok(verbatim.endsWith(">https://ex.org</a>"), "short data URLs render verbatim");
ok(!/title=/.test(verbatim), "short data URLs need no tooltip");

console.log("\n== long data URLs collapse to a label saying what the link does ==");
const long = "https://www.economics.harvard.edu/faculty";
const collapsed = renderScalar(long, "faculty_url");
ok(collapsed === '<a class="vlink" href="'+long+'" target="_blank" rel="noopener noreferrer" title="'+long+'">open faculty_url</a>',
   "a page -> open <field>, full address in the tooltip and href\n         got " + collapsed);
ok(renderScalar(long, "homepage").endsWith(">open homepage</a>"), "the label follows the field name");
ok(renderScalar(long, null).endsWith(">open link</a>"), "with no field name it degrades to \"open link\"");
ok(renderScalar(long, 'a "b" <c>').endsWith(">open a &quot;b&quot; &lt;c&gt;</a>"), "the field name is escaped");
ok(renderScalar("http://ab.co/12345678", "u").endsWith(">open u</a>"), "21 chars is over the limit");
ok(renderScalar("http://ab.co/1234567", "u").endsWith(">http://ab.co/1234567</a>"), "20 chars is not");
ok(renderValue(["https://example.org/a/very/long/path", "https://ex.org"], "urls")
   === '<span class="chip"><a class="vlink" href="https://example.org/a/very/long/path" target="_blank" rel="noopener noreferrer" title="https://example.org/a/very/long/path">open urls</a></span>'
     + '<span class="chip"><a class="vlink" href="https://ex.org" target="_blank" rel="noopener noreferrer">https://ex.org</a></span>',
   "applies per chip inside arrays, labelled by the field");
ok(renderObjLine({url:"https://example.org/a/very/long/path"}, "refs").includes(">open url</a>"),
   "inside object lines the label names the leaf key, not the parent");

/* the label reflects what following the link actually does */
const label = (u, k) => renderScalar(u, k).replace(/<\/?a[^>]*>/g, "");
console.log("  -- pdf --");
[ "https://example.org/papers/aer-2019.pdf",
  "https://example.org/papers/AER-2019.PDF",
  "https://example.org/dl?x=1&file=paper.pdf",
  "https://example.org/papers/w12345.pdf#page=3",
].forEach(u => ok(label(u, "paper") === "download pdf", "should read `download pdf`: " + u + " -> " + label(u, "paper")));

console.log("  -- other downloads --");
[ ["https://example.org/data/replication.zip", "replication"],
  ["https://example.org/files/table.xlsx?v=2", "tables"],
  ["https://example.org/archive/dataset.tar.gz", "data"],
  ["https://example.org/survey/responses.csv", "raw"],
  ["https://example.org/stata/analysis.dta", "code"],
  ["https://example.org/media/interview.mp3", "audio"],
  ["https://example.org/releases/app-1.2.3.dmg", "installer"],
].forEach(([u, k]) => ok(label(u, k) === "download", "should read `download`: " + u + " -> " + label(u, k)));

console.log("  -- pages --");
[ ["https://www.economics.harvard.edu/faculty", "homepage", "open homepage"],
  ["https://example.org/index.html", "page", "open page"],
  ["https://example.org/profile.php?id=42", "profile", "open profile"],
  ["https://example.org/pdf/collection/browse", "library", "open library"],
  ["https://example.org/paper.pdf.html", "wrapper", "open wrapper"],
  ["https://example.org/a/very/long/path/here", "src", "open src"],
].forEach(([u, k, want]) => ok(label(u, k) === want, `should read \`${want}\`: ${u} -> ${label(u, k)}`));
/* identifier links are never shortened, however long */
const longDoi = "10.1002/(SICI)1099-1255(199709/10)12:5<517::AID-JAE457>3.0.CO;2-J";
ok(renderScalar(longDoi, "doi").endsWith(">" + longDoi.replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</a>"),
   "a long DOI still shows the identifier, never a label");
ok(renderScalar("www.example.org/a/very/long/path", "homepage").includes(">www.example.org/a/very/long/path</a>"),
   "a derived bare-host link still shows the value");
ok(renderScalar(true, "flag") === '<span class="bool b-true">true</span>', "booleans unchanged");
ok(renderScalar(1998, "year") === "1998", "plain scalar unchanged");
const chips = renderValue(["10.1093/qje/qjaa021", "not/a/doi"], "dois");
ok(chips.includes('<span class="chip"><a class="vlink" href="https://doi.org/10.1093/qje/qjaa021"'), "scalar arrays link per chip");
ok(chips.includes('<span class="chip">not/a/doi</span>'), "non-matching chip stays plain");
const nested = renderValue({doi:"10.1257/jel.20191450", year:2019}, "refs");
ok(nested.includes('href="https://doi.org/10.1257/jel.20191450"'), "nested object leaves link by their own key");
ok(nested.includes('<span class="v">2019</span>'), "nested non-id leaf stays plain");
const objline = renderObjLine({doi:"10.1086/261876", openalex_id:"W1978296103", year:1991}, "refs");
ok(objline.includes('href="https://doi.org/10.1086/261876"') &&
   objline.includes('href="https://openalex.org/W1978296103"'), "object lines link each leaf");
ok(renderObjLine({title:"A paper", journal:"J of Ex"}, "works") ===
   '<div class="pub">A paper <span class="j">— J of Ex</span></div>', "publication lines unchanged");
ok(renderValue(null, "doi") === '<span class="muted">—</span>', "null unchanged");
ok(renderValue([], "dois") === '<span class="muted">[]</span>', "empty array unchanged");

console.log("\n== arrays whose elements differ in type ==");
ok(renderValue([{title:"A"}, null], "refs").includes("A"),
   "a null among objects renders the objects instead of throwing");
ok(!/\[object Object\]/.test(renderValue([1, {a:1}], "refs")),
   "an object after a number is not stringified to [object Object]");
ok(renderValue([{a:1}, "text"], "refs").includes("text"),
   "a string after an object keeps its own value");
ok(!renderValue([{a:1}, "text"], "refs").includes('"0": t'),
   "and is not exploded into character-index pairs");
ok(renderValue([{doi:"10.1257/aer.20190623"}, "note"], "refs").includes("doi.org"),
   "objects in a mixed array still get their links");

console.log("\n== escaping / injection ==");
const nasty = renderScalar('10.1234/<script>alert(1)</script>', "doi");
ok(!nasty.includes("<script>"), "no raw markup in output");
ok(nasty.includes("%3Cscript%3E"), "identifier is percent-encoded into the href");
const quoted = renderScalar('10.1234/a"onmouseover="x', "doi");
ok(!/="[^"]*"[a-z]+="x/.test(quoted.replace(/&quot;/g,"")), "quotes cannot break out of the attribute");
ok(renderScalar('javascript:alert(1)', "homepage") === "javascript:alert(1)".replace(/:/g,":"), "no scheme passthrough");
ok(!/href="javascript/i.test(renderScalar("javascript:alert(1)", "homepage")), "javascript: never becomes an href");
ok(!/href="javascript/i.test(renderScalar("javascript:alert(1)", "url")), "javascript: never becomes an href (url field)");

console.log("\n== off switch ==");
state.autoLink = false;
ok(renderScalar("10.1257/aer.20190623", "doi") === "10.1257/aer.20190623", "auto-links disappear when off");
ok(/^<a class="vlink" href="https:\/\/example\.org/.test(renderScalar("https://example.org", "homepage")), "data URLs still link when off");
state.autoLink = true;

console.log("\n== registry hygiene ==");
for(const L of LINKERS){
  ok(!L.re.global, L.id + ": regex must not be global");
  ok(L.re.source.startsWith("^") && L.re.source.endsWith("$"), L.id + ": regex must be anchored");
  ok(typeof L.url === "function" && typeof L.label === "string" && ["self","name","plan"].includes(L.tier),
     L.id + ": well-formed entry");
  ok(L.tier === "self" || L.fields, L.id + ": non-self tiers need a field gate");
}
const ids = LINKERS.map(L=>L.id);
ok(new Set(ids).size === ids.length, "resolver ids are unique");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
