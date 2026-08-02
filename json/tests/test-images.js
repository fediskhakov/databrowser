/* Unit tests for image-field detection, sliced out of the page. */
const { slice } = require("./lib.js");

const src = [
  "const bare = () => Object.create(null);",
  "const isRec = r => !!r && typeof r==='object';",
  slice("const esc = s =>", "\n"),
  "const state = {scalarFields: [], values: {}, imageFields: [], imageAuto: null, imageSel: null};",
  "const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]+/g,'_');",
  slice("const IMG_EXT=", "return isImageURL(s) || (key!=null && IMG_NAME.test(normKey(key)) && isURL(s));\n}"),
  slice("function detectImageFields(){", "\n}"),
  slice("function imageField(){", "\n}"),
  slice("function imageHTML(src,alt){", "\n}"),
  "module.exports = {state, isImageURL, detectImageFields, imageField, imageHTML, IMG_NAME};"
].join("\n");

const mod = { exports: {} };
new Function("module", src)(mod);
const { state, isImageURL, detectImageFields, imageField, imageHTML } = mod.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if(c) pass++; else { fail++; console.log("  FAIL " + m); } };

console.log("\n== isImageURL ==");
[ "https://example.org/a.jpg", "https://example.org/a.jpeg", "http://x.io/b.PNG",
  "https://c.dev/d.gif", "https://c.dev/e.webp", "https://c.dev/f.avif",
  "https://c.dev/g.svg", "https://c.dev/h.bmp", "https://c.dev/i.ico",
  "https://c.dev/j.tif", "https://c.dev/k.tiff",
  "https://c.dev/l.png?w=400&h=400", "https://c.dev/m.jpg#frag",
  "//cdn.example.org/n.png", "data:image/png;base64,iVBORw0KGgo=",
  "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
].forEach(u => ok(isImageURL(u), "should be an image URL: " + u));

[ "https://example.org/page", "https://example.org/notes.pdf", "https://example.org/data.json",
  "/local/a.png", "a.png", "example.org/a.png", "data:text/plain;base64,aGk=",
  "https://example.org/a.jpg.html", "", "10.1257/aer.20190623", "not a url at all",
].forEach(u => ok(!isImageURL(u), "should NOT be an image URL: " + JSON.stringify(u)));

console.log("\n== detectImageField: per-column, 90% rule ==");
function detect(cols){
  state.scalarFields = Object.keys(cols);
  state.values = {};
  state.imageSel = null;
  for(const k in cols){ const m = new Map(); for(const v of cols[k]) m.set(String(v), 1); state.values[k] = m; }
  detectImageFields();
  return imageField();
}
const IMG = ["https://e.org/1.jpg","https://e.org/2.jpg","https://e.org/3.jpg","https://e.org/4.jpg"];
ok(detect({name:["a","b"], portrait:IMG}) === "portrait", "a column of image URLs is found");
ok(detect({name:["a","b"], url:["https://e.org/p1","https://e.org/p2"]}) === null,
   "plain URLs in a plainly-named field are not pictures");
ok(detect({avatar:["https://e.org/u/1","https://e.org/u/2"]}) === "avatar",
   "extensionless URLs count in a field named like a picture");
ok(detect({photo_url:["https://e.org/u/1"], logo:["https://e.org/l/1"]}) === "photo_url",
   "the first qualifying field is the default card image");
ok(JSON.stringify(state.imageFields) === '["photo_url","logo"]',
   "but every qualifying column is offered: " + JSON.stringify(state.imageFields));
state.imageSel = "logo";
ok(imageField() === "logo", "the picker can choose a later column");
state.imageSel = "";
ok(imageField() === null, "(none) means no thumbnail at all");
state.imageSel = "not_a_field";
ok(imageField() === null, "a stale selection from a URL degrades to no image, never a broken one");
state.imageSel = null;
ok(detect({mixed:["https://e.org/1.jpg","https://e.org/2.jpg","plain text","https://e.org/4.jpg"]}) === null,
   "a mixed column (3 of 4) is below the 90% threshold, so it is not chosen on its own");
ok(JSON.stringify(state.imageFields) === '["mixed"]', "but it IS offered in the picker");
state.imageSel = "mixed";
ok(imageField() === "mixed", "and picking it works");
state.imageSel = null;

console.log("\n== a single image in a column is enough to be offered ==");
const oneOf = n => { const a = ["https://e.org/only.jpg"]; while(a.length < n) a.push("note " + a.length); return a; };
ok(detect({notes: oneOf(50)}) === null, "one image among 50 notes is never chosen automatically");
ok(state.imageFields.includes("notes"), "but the column is offered so it can be picked");
state.imageSel = "notes";
ok(imageField() === "notes", "picking it shows that one record's picture");
state.imageSel = null;
ok(detect({notes: oneOf(600)}) === null && state.imageFields.includes("notes"),
   "found even past the 200-value ratio sample");
ok(detect({a: oneOf(5), b: ["https://e.org/1.jpg","https://e.org/2.jpg"]}) === "b",
   "the automatic pick skips the loose column and takes the solid one");
ok(JSON.stringify(state.imageFields) === '["a","b"]', "while both stay on offer");
ok(detect({notes: ["no pictures here", "none at all"]}) === null && !state.imageFields.length,
   "a column with no image at all is not offered");
ok(detect({tight:["https://e.org/1.jpg","https://e.org/2.jpg","https://e.org/3.jpg",
                  "https://e.org/4.jpg","https://e.org/5.jpg","https://e.org/6.jpg",
                  "https://e.org/7.jpg","https://e.org/8.jpg","https://e.org/9.jpg",
                  "https://e.org/10.jpg"]}) === "tight", "10 of 10 qualifies");
ok(detect({empty:[]}) === null, "an empty column is not a picture column");
ok(detect({rank:[1,2,3], year:[1998,2003]}) === null, "numeric columns are never pictures");

console.log("\n== markup ==");
const h = imageHTML("https://e.org/a.jpg", 'Harvard "Econ" <dept>');
ok(h.startsWith('<a class="cardimg" href="https://e.org/a.jpg"'), "wrapped in a link to the full image");
ok(h.includes('rel="noopener noreferrer"') && h.includes('referrerpolicy="no-referrer"'), "hardened");
ok(h.includes('loading="lazy"') && h.includes('decoding="async"'), "off-screen images are not fetched");
ok(h.includes("onerror="), "a dead URL removes the box instead of showing a broken icon");
ok(!h.includes('<dept>') && h.includes("&lt;dept&gt;") && h.includes("&quot;Econ&quot;"),
   "alt text is escaped\n         got " + h);
const evil = imageHTML('https://e.org/a.jpg" onload="alert(1)', "x");
ok(!evil.includes('onload="'), "quotes in the URL cannot close the attribute and add a handler");
ok(evil.includes("&quot; onload=&quot;"), "the quotes are escaped into inert text\n         got " + evil);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
