/* Tests the global-search query parser and the three matching modes, sliced out
   of the page. "plain" (the default) takes the query as one literal string;
   "terms" splits it into OR-ed words, with "double quoted" runs as exact phrases
   (spaces included); "whole" OR-s the same terms but requires each to be a
   complete field value rather than a substring of one. */
const { slice } = require("./lib.js");

const src = [
  slice("function parseSearch(q){", "return false;\n}"),
  "module.exports = {parseSearch, searchOK};"
].join("\n");

/* The input handler lowercases the query before storing it, so queries here are
   given lowercase, as searchOK receives them. */
const state = { search: "", searchMode: "plain" };
const mod = { exports: {} };
new Function("module", "state", src)(mod, state);
const { parseSearch, searchOK } = mod.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if(c) pass++; else { fail++; console.log("  FAIL " + m); } };
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want),
     m + "\n         got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));

/* ---- parsing ---- */
eq(parseSearch("foo"), ["foo"], "a single word is a single term");
eq(parseSearch("foo bar"), ["foo", "bar"], "words split on spaces");
eq(parseSearch("  spaced   out  "), ["spaced", "out"], "runs of spaces collapse");
eq(parseSearch('"new york"'), ["new york"], "a quoted phrase keeps its space");
eq(parseSearch('"new york" boston'), ["new york", "boston"], "phrase and word mix");
eq(parseSearch('a "b c" d "e f"'), ["a", "b c", "d", "e f"], "several phrases interleave with words");
eq(parseSearch('""'), [], "an empty phrase contributes nothing");
eq(parseSearch('"'), [], "a lone quote contributes nothing");
eq(parseSearch('"unclosed phrase'), ["unclosed phrase"], "an unclosed quote runs to the end");
eq(parseSearch('" padded "'), ["padded"], "phrases are trimmed");

/* ---- matching ---- */
const recs = [
  { name: "New York University", city: "New York", rank: 1 },
  { name: "Boston College", city: "Boston", tags: ["private", "jesuit"] },
  { name: "University of York", country: "United Kingdom" },
  { a: "new", b: "york" },                       // the words, but never together
];
const hits = q => { state.search = q; return recs.map(r => searchOK(r) ? 1 : 0).join(""); };

/* ---- plain: the default, the whole query as one string ---- */
ok(hits("boston") === "0100", "plain mode finds a single word");
ok(hits("york boston") === "0000", "plain mode: the query is one literal string, not OR-ed words");
ok(hits("new york") === "1000", "plain mode: spaces are part of the string");
ok(hits('"new york"') === "0000", "plain mode: quotes are literal characters");
ok(hits("") === "1111", "plain mode: an empty query matches everything");
ok(hits("york") === "1011", "plain mode matches inside a field, not just a whole one");

/* ---- terms: words OR-ed, quoted runs held together ---- */
state.searchMode = "terms";
ok(hits("") === "1111", "an empty query matches everything");
ok(hits('""') === "1111", "a query of only quotes matches everything");
ok(hits("boston") === "0100", "a single word matches by substring");
ok(hits("york boston") === "1111", "two words are OR-ed, not required together");
ok(hits('"new york"') === "1000", "a phrase must appear verbatim in one field");
ok(hits('"new york" boston') === "1100", "phrase OR word unions both");
ok(hits('"boston college"') === "0100", "matching is case-insensitive");
ok(hits("jesuit") === "0100", "array fields are searched through their JSON text");
ok(hits('"united kingdom" jesuit') === "0110", "phrase and word each pull in their own records");
ok(hits("zzz") === "0000", "a term found nowhere matches nothing");
ok(hits('"of york"') === "0010", "a phrase distinguishes records sharing its words");

/* ---- whole: the same terms, but each must BE a field ---- */
state.searchMode = "whole";
ok(hits("york") === "0001", "a term matches only a field that is exactly it");
ok(hits("boston") === "0100", "the city field alone qualifies; the name only contains the word");
ok(hits('"new york"') === "1000", "a quoted phrase is how a multi-word value is asked for");
ok(hits('"university of york"') === "0010", "and it must still fill the field entirely");
ok(hits("of york") === "0001", "unquoted it is two terms, and only a field that IS york matches");
ok(hits("jesuit") === "0100", "an array's elements each count as a whole value");
ok(hits('"[\"private\",\"jesuit\"]"') === "0000", "the array's JSON text is not one of them");
ok(hits("1") === "1000", "numbers are compared through their printed form");
ok(hits("york new") === "0001", "terms stay OR-ed: one whole-field hit is enough");
ok(hits("") === "1111", "an empty query matches everything");
state.searchMode = "terms";

/* the cache keys on the query string, so flipping back and forth must not stick */
state.search = "boston"; searchOK(recs[0]);
state.search = "york";
ok(searchOK(recs[0]), "changing the query reparses rather than reusing the old terms");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
