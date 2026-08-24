/* End-to-end: drives the real page over CDP — clicks the field checkboxes and
   reads back location.search and the rendered cards. Needs a static server on
   $PORT serving the json/ directory. */
const { spawn } = require("child_process");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2] || "8796";
const CDP = 9333;
const CHROME = chromeBin();
const PAGE = `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json`;

let pass = 0, fail = 0;
const ok = (c, m) => { if(c) pass++; else { fail++; console.log("  FAIL " + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let step = "startup";
const watchdog = setTimeout(() => { console.error("WATCHDOG: stuck at step: " + step); try{chrome.kill()}catch(e){}; process.exit(2); }, 75000);

const chrome = spawn(CHROME, ["--headless", "--disable-gpu", `--remote-debugging-port=${CDP}`,
  "--user-data-dir=" + profileDir("interaction"),
  PAGE], {stdio: "ignore"});

(async () => {
  let target = null;
  for(let i = 0; i < 100 && !target; i++){
    await sleep(200);
    try{
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      target = list.find(t => t.type === "page" && t.url.includes("json-browser.html"));
    }catch(e){}
  }
  if(!target) throw new Error("no CDP target");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0; const pending = new Map();
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if(m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
  async function evaluate(expr){
    step = expr.replace(/\s+/g," ").slice(0, 90);
    const r = await Promise.race([
      send("Runtime.evaluate", {expression: expr, returnByValue: true, awaitPromise: true}),
      sleep(15000).then(() => { throw new Error("CDP evaluate timed out: " + step); })
    ]);
    if(r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  }

  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('[data-fieldtog]').length`)) break;
    await sleep(200);
  }

  const q = `document.querySelectorAll('[data-fieldtog]').length`;
  ok(await evaluate(q) === 11, "11 toggleable fields (the title field's box is fixed on)");
  /* :not(.shortrow) — the short-copy row lists the same fields again, for the S button */
  ok(await evaluate(`document.querySelectorAll('#metaBody .kv:not(.shortrow) .ftog').length`) === 12,
     "all 12 fields listed");
  ok(await evaluate(`document.querySelector('#metaBody .ftog.fixed input').disabled &&
                     document.querySelector('#metaBody .ftog.fixed').textContent === 'repec_id'`),
     "the title field is listed but not toggleable");
  ok(!(await evaluate("location.search")).includes("h."), "clean URL before any toggle");

  const settle = async (expr, want, tries = 30) => {   // image onerror timing is network-dependent
    for(let i = 0; i < tries; i++){
      if(await evaluate(expr) === want) return true;
      await sleep(200);
    }
    return await evaluate(expr);
  };
  const VISIBLE = `[...document.querySelectorAll('#cards .cardimg')].filter(e => getComputedStyle(e).display !== 'none').length`;

  console.log("\n== sort section ==");
  ok(await evaluate(`JSON.stringify([...document.querySelectorAll('.side h2')]
       .map(h => h.textContent.trim().split(' ')[0]))`) === '["Sort","Filters","Display"]',
     "the sidebar reads Sort, Filters, Display");
  ok(await evaluate(`document.querySelector('#sortField').closest('.side') !== null &&
       document.querySelector('#sortField').compareDocumentPosition(document.querySelector('#filters'))
         === Node.DOCUMENT_POSITION_FOLLOWING`),
     "the sort dropdown is above the filters");
  ok(await evaluate(`(() => {
       const acts = document.querySelector('.side .actions');
       const h2 = [...document.querySelectorAll('.side h2')].find(h => h.textContent.startsWith('Filters'));
       return h2.compareDocumentPosition(acts) === Node.DOCUMENT_POSITION_FOLLOWING &&
              acts.compareDocumentPosition(document.querySelector('#filters')) === Node.DOCUMENT_POSITION_FOLLOWING;
     })()`), "Reset filters / Collapse all now sit inside the Filters section");

  const labels = await evaluate(`[...document.querySelectorAll('#sortField option')].map(o => o.textContent)`);
  ok(labels[0] === "(file order)", "first option is (file order)");
  ok(labels.length === 1 + 12 * 2, `every active field appears twice (${labels.length} options for 12 fields)`);
  ok(labels[1] === "repec_id ▴" && labels[2] === "repec_id ▾",
     "ascending then descending, adjacent: " + labels.slice(1, 5).join(" / "));
  ok(await evaluate(`[...document.querySelectorAll('#sortField option')]
       .filter(o => o.dataset.desc === '1').length`) === 12, "half of them carry the descending flag");
  ok(await evaluate(`document.querySelector('#sortField').selectedIndex`) === 0, "file order by default");

  const column = f => evaluate(`[...document.querySelectorAll('#cards .kv')]
      .filter(r => r.querySelector('.k').textContent === '${f}')
      .map(r => r.querySelector('.v').textContent)`);
  const pick = (f, desc = false) => evaluate(`(() => { const s = document.querySelector('#sortField');
      s.selectedIndex = [...s.options].findIndex(o => o.value === '${f}' && (o.dataset.desc === '1') === ${desc});
      s.dispatchEvent(new Event('change', {bubbles: true})); })()`).then(() => sleep(300));

  const fileOrder = await column("university");
  const fileOrderCountry = await column("country");

  console.log("  -- ascending --");
  await pick("university");
  const byName = await column("university");
  ok(JSON.stringify(byName) !== JSON.stringify(fileOrder), "choosing a field reorders the records");
  ok(byName.every((v, i) => i === 0 || v.localeCompare(byName[i-1], undefined, {sensitivity:"base", numeric:true}) >= 0),
     "ascending by text: " + byName.slice(0, 3).join(" | "));
  let url = await evaluate("location.search");
  ok(url.includes("sa=university") && !url.includes("sd="), "URL carries sa= for ascending\n         got " + url);

  await pick("world_rank");
  const byRank = (await column("world_rank")).map(Number);
  ok(byRank.every((v, i) => i === 0 || v >= byRank[i-1]),
     "ascending by number, not by text: " + byRank.slice(0, 5).join(", "));

  console.log("  -- descending --");
  await pick("world_rank", true);
  const byRankDesc = (await column("world_rank")).map(Number);
  ok(byRankDesc.every((v, i) => i === 0 || v <= byRankDesc[i-1]),
     "descending by number: " + byRankDesc.slice(0, 5).join(", "));
  ok(byRankDesc[0] > byRank[0], "and it really is the other end of the data");
  url = await evaluate("location.search");
  ok(url.includes("sd=world_rank") && !url.includes("sa="), "descending is sd=, with no separate flag\n         got " + url);

  await pick("university", true);
  const byNameDesc = await column("university");
  ok(byNameDesc.every((v, i) => i === 0 || v.localeCompare(byNameDesc[i-1], undefined, {sensitivity:"base", numeric:true}) <= 0),
     "descending by text: " + byNameDesc.slice(0, 3).join(" | "));

  /* faculty_url is missing on one record: the empties stay at the bottom either way */
  await pick("faculty_url", true);
  ok(await evaluate(`[...document.querySelectorAll('#cards .card')]
       .slice(0, 5).every(c => [...c.querySelectorAll('.kv .k')].some(k => k.textContent === 'faculty_url'))`),
     "descending does not dredge records missing the field to the top");
  ok(await evaluate(`document.querySelectorAll('#cards .card').length`) === 100, "paging unaffected");

  console.log("  -- reload and suspension --");
  /* the pre-2026-08 spelling, to prove old links still work */
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json&sort=world_rank&desc=1`});
  await sleep(1500);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`document.querySelector('#sortField').selectedOptions[0].textContent`) === "world_rank ▾",
     "a shared link restores the field AND the direction");
  const reloaded = (await column("world_rank")).map(Number);
  ok(reloaded.every((v, i) => i === 0 || v <= reloaded[i-1]), "with the records ordered accordingly");

  await evaluate(`document.querySelector('[data-fieldtog="world_rank"]').click()`);
  await sleep(300);
  ok(await evaluate(`document.querySelector('#sortField').selectedIndex`) === 0,
     "switching the sort field off suspends the sort");
  ok(!(await evaluate(`[...document.querySelectorAll('#sortField option')].map(o => o.value)`)).includes("world_rank"),
     "and drops both of its entries from the list");
  url = await evaluate("location.search");
  ok(url.includes("sd=world_rank"), "the choice is remembered in the URL");
  await evaluate(`document.querySelector('[data-fieldtog="world_rank"]').click()`);
  await sleep(300);
  ok(await evaluate(`document.querySelector('#sortField').selectedOptions[0].textContent`) === "world_rank ▾",
     "switching it back on resumes the same field and direction");
  ok(JSON.stringify((await column("world_rank")).map(Number)) === JSON.stringify(reloaded), "with the same order");

  await pick("");
  url = await evaluate("location.search");
  ok(!/[&?]s[ld]?[ad]=/.test(url), "(file order) leaves no sort parameter at all\n         got " + url);
  ok(JSON.stringify(await column("university")) === JSON.stringify(fileOrder),
     "and restores the file order — sorting never reordered the underlying data");
  ok(JSON.stringify(await column("country")) === JSON.stringify(fileOrderCountry), "for every column");

  console.log("\n== sorting on more than one field ==");
  const nBoxes = () => evaluate(`document.querySelectorAll('#sortbox select').length`);
  const chosen = () => evaluate(`[...document.querySelectorAll('#sortbox select')]
      .map(s => s.selectedOptions[0].textContent)`);
  const setLevel = (lvl, f, desc = false) => evaluate(`(() => {
      const s = document.querySelectorAll('#sortbox select')[${lvl}];
      s.selectedIndex = [...s.options].findIndex(o => o.value === '${f}' && (o.dataset.desc === '1') === ${desc});
      s.dispatchEvent(new Event('change', {bubbles: true})); })()`).then(() => sleep(350));
  const col = f => evaluate(`[...document.querySelectorAll('#cards .kv')]
      .filter(r => r.querySelector('.k').textContent === '${f}')
      .map(r => r.querySelector('.v').textContent)`);

  await pick("");                                  // back to file order
  ok(await nBoxes() === 1, "one select while nothing is sorted");

  /* country has plenty of duplicates, so a second level is offered */
  await setLevel(0, "country");
  ok(await nBoxes() === 2, `a field with duplicates offers a second level (${await nBoxes()} selects)`);
  ok((await chosen())[1] === "(file order)" || (await chosen())[1] === "(none)",
     "the new one starts empty: " + JSON.stringify(await chosen()));

  await setLevel(1, "university");
  const c1 = await col("country"), u1 = await col("university");
  ok(c1.every((v, i) => i === 0 || v.localeCompare(c1[i-1], undefined, {sensitivity:"base"}) >= 0),
     "the first level still governs: " + c1.slice(0, 3).join(" | "));
  ok(u1.every((v, i) => i === 0 || c1[i] !== c1[i-1] ||
       v.localeCompare(u1[i-1], undefined, {sensitivity:"base", numeric:true}) >= 0),
     "and within one country the second orders the universities");
  let su = await evaluate("location.search");
  ok(su.includes("sa=country") && su.includes("sa=university") && !su.includes("sd="),
     "both levels appear, in order, with no numbering needed\n         got " + su);
  ok(su.indexOf("sa=country") < su.indexOf("sa=university"),
     "and their order in the URL is their order as levels");

  /* directions are per level */
  await setLevel(1, "university", true);
  const u2 = await col("university"), c2 = await col("country");
  ok(u2.every((v, i) => i === 0 || c2[i] !== c2[i-1] ||
       v.localeCompare(u2[i-1], undefined, {sensitivity:"base", numeric:true}) <= 0),
     "the second level can run the other way while the first does not");
  su = await evaluate("location.search");
  ok(su.includes("sa=country") && su.includes("sd=university"),
     "each level carries its own direction in its own name\n         got " + su);

  /* a level that resolves everything stops the cascade */
  await setLevel(1, "repec_id");                   // unique per record
  ok(await nBoxes() === 2, `no ties left, so no third select is offered (${await nBoxes()})`);

  console.log("  -- the cascade stops at three --");
  await setLevel(1, "category");                   // still plenty of ties
  ok(await nBoxes() === 3, "a third level appears while ties remain");
  await setLevel(2, "country_code");               // ties still remain after three
  ok(await nBoxes() === 3, `never a fourth (${await nBoxes()})`);
  su = await evaluate("location.search");
  ok(su.includes("sa=country_code") || su.includes("sd=country_code"), "the third level is in the URL too");

  /* levels are indented rather than labelled */
  ok(!(await evaluate(`document.querySelector('#sortbox').textContent`)).includes("then by"),
     "no wording between the levels");
  /* geometry needs the panel actually on screen: the default window is narrower
     than the 820px breakpoint, where the sidebar starts folded away */
  await send("Emulation.setDeviceMetricsOverride", {width: 1400, height: 900, deviceScaleFactor: 1, mobile: false});
  await sleep(400);
  const indents = await evaluate(`[...document.querySelectorAll('#sortbox .slev')]
      .map(d => Math.round(d.getBoundingClientRect().left))`);
  ok(indents[0] < indents[1] && indents[1] < indents[2],
     "each level is stepped in a little: " + JSON.stringify(indents));
  const widths = await evaluate(`[...document.querySelectorAll('#sortbox select')]
      .map(s => Math.round(s.getBoundingClientRect().right))`);
  ok(new Set(widths).size === 1, "and they still line up on the right: " + JSON.stringify(widths));
  await send("Emulation.clearDeviceMetricsOverride", {});
  await sleep(300);

  console.log("  -- restoring a multi-level sort --");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html`
    + `?file=econ_departments.json&sort=country&sort2=university&desc2=1`});
  await sleep(1400);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(JSON.stringify((await chosen()).slice(0, 2)) === JSON.stringify(["country ▴", "university ▾"]),
     "a shared link restores every level and its direction: " + JSON.stringify(await chosen()));
  const c3 = await col("country"), u3 = await col("university");
  ok(JSON.stringify(c3) === JSON.stringify(c2) && JSON.stringify(u3) === JSON.stringify(u2),
     "and reproduces exactly the same order");

  /* dropping a level drops the ones below it */
  await setLevel(0, "");
  ok(await nBoxes() === 1 && !(await evaluate("location.search")).includes("sort"),
     "choosing (file order) at the top clears the whole cascade");

  console.log("\n== short URL parameters ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json`});
  await sleep(1200);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  const pick2 = (id, v) => evaluate(`(() => { const s=document.querySelector('${id}');
      s.value='${v}'; s.dispatchEvent(new Event('change', {bubbles: true})); })()`).then(() => sleep(300));

  await pick2("#titleField", "university");
  let su2 = await evaluate("location.search");
  ok(su2.includes("t=university") && !su2.includes("title="), "the title field is t=\n         got " + su2);

  await pick2("#subField", "country");
  su2 = await evaluate("location.search");
  ok(su2.includes("st=country") && !su2.includes("sub="), "the subtitle is st=\n         got " + su2);

  await pick2("#subField", "");
  su2 = await evaluate("location.search");
  ok(!su2.includes("st=") && !su2.includes("__none__"),
     "choosing no subtitle writes nothing at all — absence is none\n         got " + su2);
  ok(await evaluate(`document.querySelector('#subField').value`) === "", "and the select shows (none)");

  /* a link in the old spelling still opens the same view */
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html`
    + `?file=econ_departments.json&title=university&sub=country&sort=world_rank&desc=1`});
  await sleep(1400);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`document.querySelector('#titleField').value`) === "university" &&
     await evaluate(`document.querySelector('#subField').value`) === "country",
     "old title=/sub= links still work");
  ok(await evaluate(`document.querySelector('#sortField').selectedOptions[0].textContent`) === "world_rank ▾",
     "and so do old sort=/desc= links");
  su2 = await evaluate("location.search");
  ok(su2.includes("t=university") && su2.includes("st=country") && su2.includes("sd=world_rank"),
     "opening one rewrites it in the short form\n         got " + su2);
  ok(!/[&?](title|sub|sort|desc|last)=/.test(su2), "with none of the long names left behind");

  /* leave the app as we found it: the blocks below assume the default title/subtitle */
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json`});
  await sleep(1400);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }

  console.log("\n== packed URL parameters ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json`});
  await sleep(1200);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  const tick3 = (f, v) => evaluate(`(() => {
      document.querySelector('.ffield[data-field="${f}"]').open = true; })()`).then(() => sleep(250))
    .then(() => evaluate(`document.querySelector('.ffield[data-field="${f}"] input[data-val="${v}"]').click()`))
    .then(() => sleep(300));

  for(const v of ["United States", "United Kingdom", "Canada", "France"]) await tick3("country", v);
  let pu = await evaluate("location.search");
  ok((pu.match(/f\.country=/g) || []).length === 1,
     "four values, one parameter\n         got " + pu);
  ok(pu.includes("f.country=United+States,United+Kingdom,Canada,France"), "comma-joined in selection order");
  ok(pu.length < 130, `and the whole URL is ${pu.length} characters`);
  const packedCount = await evaluate(`+document.querySelector('#resCount').textContent.replace(/,/g,'')`);

  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html` + pu});
  await sleep(1400);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`+document.querySelector('#resCount').textContent.replace(/,/g,'')`) === packedCount,
     "reopening the packed link selects exactly the same records");
  await evaluate(`document.querySelector('.ffield[data-field="country"]').open = true`);
  await sleep(300);                       // the panel body renders lazily on opening
  ok(await evaluate(`[...document.querySelectorAll('.ffield[data-field="country"] input:checked')].length`) === 4,
     "and opening the panel shows all four values ticked again");

  /* the pre-packing spelling, repeated one value at a time, still works */
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html`
    + `?file=econ_departments.json&f.country=United+States&f.country=United+Kingdom`
    + `&f.country=Canada&f.country=France&h.category=1`});
  await sleep(1400);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`+document.querySelector('#resCount').textContent.replace(/,/g,'')`) === packedCount,
     "an old repeated-parameter link gives the same result");
  ok(await evaluate(`document.querySelector('[data-fieldtog="category"]').checked`) === false,
     "and its per-field h.category=1 is understood too");
  pu = await evaluate("location.search");
  ok((pu.match(/f\.country=/g) || []).length === 1 && /[&?]h=category(,|$)/.test(pu),
     "opening one rewrites it in the packed form\n         got " + pu);

  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json`});
  await sleep(1400);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }

  console.log("\n== uncheck one field ==");
  url = await evaluate(`document.querySelector('[data-fieldtog="country_code"]').click(); location.search`);
  ok(/[&?]h=(.*,)?country_code(,|$)/.test(url), "unchecking names the field in the packed h=\n         got " + url);
  ok(await evaluate(`document.querySelector('#cards').innerHTML.includes('>country_code<')`) === false,
     "the field disappears from the cards");
  ok(await evaluate(`document.querySelector('[data-fieldtog="country_code"]').closest('.ftog').classList.contains('off')`),
     "its chip is struck through");
  ok((await evaluate(`document.querySelector('#hidNote').textContent`)).includes("1 hidden"), "hidden count updates");
  ok(await evaluate(`getComputedStyle(document.querySelector('.ffield[data-field="country_code"]')).display === 'none'`),
     "its sidebar filter panel disappears");
  ok(await evaluate(`document.querySelector('#filterHint').textContent`) === "(11 of 12 fields)",
     "the filter heading counts what is shown");
  ok(await evaluate(`document.querySelector('#resCount').textContent`) === "379",
     "record count unaffected (that field had no filter)");

  console.log("\n== re-check it ==");
  url = await evaluate(`document.querySelector('[data-fieldtog="country_code"]').click(); location.search`);
  ok(!url.includes("h.country_code"), "re-checking removes the parameter\n         got " + url);
  ok(await evaluate(`document.querySelector('#cards').innerHTML.includes('>country_code<')`), "the field comes back");
  ok(await evaluate(`getComputedStyle(document.querySelector('.ffield[data-field="country_code"]')).display !== 'none'`),
     "and so does its filter panel");

  console.log("\n== a filter on a field that gets switched off ==");
  await evaluate(`document.querySelector('.ffield[data-field="country"]').open = true`);
  await sleep(300);

  /* the value list is ordered by count, commonest first */
  const rows = f => evaluate(`[...document.querySelectorAll('.ffield[data-field="${f}"] .vrow')]
      .map(r => [r.querySelector('.vtxt').textContent, +r.querySelector('.vc').textContent])`);
  let vals = await rows("country");
  ok(vals.length > 5, `the panel lists ${vals.length} values`);
  ok(vals.every((v, i) => i === 0 || v[1] <= vals[i-1][1]),
     "counts run downwards: " + vals.slice(0, 4).map(v => v[0] + " " + v[1]).join(", "));
  ok(vals[0][1] === Math.max(...vals.map(v => v[1])), "the commonest value is first");
  /* equal counts fall back to the value, so the tail is not arbitrary */
  const ties = vals.filter(v => v[1] === vals[vals.length - 1][1]).map(v => v[0]);
  ok(JSON.stringify(ties) === JSON.stringify([...ties].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)),
     "values sharing a count stay in value order: " + ties.slice(0, 4).join(", "));

  await evaluate(`document.querySelector('.ffield[data-field="world_rank"]').open = true`);
  await sleep(300);
  const numeric = await rows("world_rank");
  ok(numeric.every(v => v[1] === 1), "world_rank is unique per record, so every count is 1");
  ok(numeric.slice(0, 5).every((v, i) => i === 0 || +v[0] > +numeric[i-1][0]),
     "which leaves the numeric tiebreak in charge: " + numeric.slice(0, 5).map(v => v[0]).join(", "));
  await evaluate(`document.querySelector('.ffield[data-field="world_rank"]').open = false`);
  await sleep(200);
  await evaluate(`document.querySelector('.ffield[data-field="country"] input[data-val="United States"]').click()`);
  await sleep(300);
  const filtered = await evaluate(`document.querySelector('#resCount').textContent`);
  ok(filtered !== "379" && +filtered.replace(/,/g,"") > 0, "the filter narrows the set to " + filtered);
  const openBefore = await evaluate(`document.querySelector('.ffield[data-field="country"]').open`);

  url = await evaluate(`document.querySelector('[data-fieldtog="country"]').click(); location.search`);
  ok(await evaluate(`document.querySelector('#resCount').textContent`) === "379",
     "switching the field off suspends its filter — every record is back");
  ok(await evaluate(`document.querySelector('[data-fieldtog="country"]').closest('.ftog').classList.contains('susp')`),
     "the chip is marked as holding a suspended filter");
  ok((await evaluate(`document.querySelector('[data-fieldtog="country"]').closest('.ftog').title`)).includes("suspended"),
     "and says so on hover");
  ok(/[&?]h=(.*,)?country(,|$)/.test(url) && url.includes("f.country=United+States"),
     "the URL keeps both the switch and the suspended filter\n         got " + url);

  url = await evaluate(`document.querySelector('[data-fieldtog="country"]').click(); location.search`);
  ok(await evaluate(`document.querySelector('#resCount').textContent`) === filtered,
     "switching it back on reapplies exactly the same filter");
  ok(await evaluate(`document.querySelector('.ffield[data-field="country"] input[data-val="United States"]').checked`),
     "the value is still checked in the restored panel");
  ok(await evaluate(`document.querySelector('.ffield[data-field="country"]').open`) === openBefore,
     "the panel is still open — it was only hidden, never rebuilt");
  await evaluate(`document.querySelector('#resetFilters').click()`);
  await sleep(200);
  ok(await evaluate(`document.querySelector('#resCount').textContent`) === "379", "reset clears it again");
  ok(await evaluate(`document.querySelectorAll('#metaBody .ftog.susp').length`) === 0,
     "reset also clears the suspended-filter markers");

  console.log("\n== none / all buttons ==");
  url = await evaluate(`[...document.querySelectorAll('#metaBody button[data-tog="none"]')][0].click(); location.search`);
  const hidden = (/[&?]h=([^&]*)/.exec(url) || [,""])[1].split(",").filter(Boolean);
  ok(hidden.length === 11, `none hides the 11 toggleable fields in one parameter (${hidden.length})\n         got ` + url);
  ok((url.match(/[&?]h=/g) || []).length === 1, "packed into a single h=, not one parameter each");
  ok(!hidden.includes("repec_id"), "the title field is never hidden by none");
  ok(await evaluate(`document.querySelectorAll('#cards .kv').length`) === 0, "cards keep only their headings");
  ok(await evaluate(`document.querySelectorAll('#cards .card').length`) === 100, "the records themselves are still there");
  url = await evaluate(`[...document.querySelectorAll('#metaBody button[data-tog="all"]')][0].click(); location.search`);
  ok(!url.includes("h."), "all restores every field and shortens the URL");

  console.log("\n== survives a filter change and a reload ==");
  await evaluate(`document.querySelector('[data-fieldtog="category"]').click()`);
  await evaluate(`document.querySelector('#globalSearch').value='harvard';
                  document.querySelector('#globalSearch').dispatchEvent(new Event('input'))`);
  await sleep(300);
  url = await evaluate("location.search");
  ok(/[&?]h=(.*,)?category(,|$)/.test(url) && url.includes("q=harvard"),
     "hidden state survives a search\n         got " + url);
  const reload = `http://127.0.0.1:${PORT}/json-browser.html` + url;
  await send("Page.navigate", {url: reload});
  await sleep(1500);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('[data-fieldtog]').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`document.querySelector('[data-fieldtog="category"]').checked`) === false,
     "reloading that URL restores the unchecked box");
  ok(await evaluate(`document.querySelector('#cards').innerHTML.includes('>category<')`) === false,
     "and the field stays hidden");
  ok(/[&?]h=(.*,)?category(,|$)/.test(await evaluate("location.search")), "and the URL is re-emitted unchanged");

  console.log("\n== image fields ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=image-test.json`});
  await sleep(1500);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`document.querySelectorAll('#cards .card').length`) === 5, "5 records rendered");
  ok(await evaluate(`document.querySelectorAll('#cards .cardimg').length`) === 4,
     "4 of the 5 records get a thumbnail (one has no value)");
  ok(await evaluate(`document.querySelectorAll('#cards .card.has-img').length`) === 4, "those cards are flagged has-img");
  ok(await evaluate(`!document.querySelector('#cards').innerHTML.includes('>portrait<')`),
     "the image field is not also printed as a text row");

  console.log("\n== Card image field picker ==");
  ok(await evaluate(`[...document.querySelectorAll('#imageField option')].map(o => o.value).join('|')`)
     === "|portrait|logo|scan", "the select offers (none) plus every column holding a picture");
  ok(await evaluate(`document.querySelector('#imageField').value`) === "portrait",
     "it defaults to the first column that is mostly pictures");
  ok(!(await evaluate("location.search")).includes("img="), "the default is not written to the URL");

  /* `scan` holds one image among four text values: offered, but never chosen for you */
  ok(await evaluate(`[...document.querySelectorAll('#cards .kv')]
        .filter(r => r.querySelector('.k').textContent === 'scan').length`) === 5,
     "until picked it stays an ordinary column");
  await evaluate(`(() => { const s=document.querySelector('#imageField'); s.value='scan'; s.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(300);
  ok(await evaluate(`document.querySelectorAll('#cards .cardimg').length`) === 1,
     "picking it shows the one record that has a picture");
  ok(await evaluate(`document.querySelectorAll('#cards .card').length`) === 5,
     "the other four records render normally, just without a thumbnail");
  ok((await evaluate("location.search")).includes("img=scan"), "and the choice is shareable");
  await evaluate(`(() => { const s=document.querySelector('#imageField'); s.value='portrait'; s.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(300);
  /* the column that is NOT the card image shows as a link, never as a raw address */
  const logoCell = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('#cards .kv')].filter(r => r.querySelector('.k').textContent === 'logo');
    const a = rows[0].querySelector('a');
    return JSON.stringify({label: a.textContent, cls: a.className, tip: a.title,
                           href: a.getAttribute('href').slice(0, 22), target: a.target, n: rows.length});
  })()`).then(JSON.parse);
  ok(logoCell.label === "show image", `the other image column reads "show image" (got "${logoCell.label}")`);
  ok(logoCell.target === "_blank", "and opens in a new tab, like the thumbnail");
  ok(logoCell.cls === "vlink", "styled like every other link");
  ok(logoCell.href.startsWith("data:image/svg"), "the href is still the image itself");
  ok(logoCell.tip === "embedded image", `a data: URI shows a short tooltip, not its payload (got "${logoCell.tip}")`);
  ok(await evaluate(`!/PHN2Zy|base64,[A-Za-z0-9+/]{40}/.test(document.querySelector('#cards').textContent)`),
     "no base64 payload is ever printed as text");

  await evaluate(`(() => { const s=document.querySelector('#imageField'); s.value='logo'; s.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(300);
  ok((await evaluate("location.search")).includes("img=logo"), "picking a column writes img= to the URL");
  ok(await evaluate(`document.querySelectorAll('#cards .cardimg').length`) === 4,
     "the thumbnails move to that column (4 records carry a logo)");
  ok(await settle(VISIBLE, 2) === true, "2 of them render; the 2 unreachable remote logos collapse");
  ok(await evaluate(`[...document.querySelectorAll('#cards .kv')]
        .filter(r => r.querySelector('.k').textContent === 'portrait').length`) === 4,
     "and the former image column becomes ordinary rows");
  ok(await evaluate(`[...document.querySelectorAll('#cards .kv')]
        .filter(r => r.querySelector('.k').textContent === 'portrait')
        .every(r => r.querySelector('a') && r.querySelector('a').textContent === 'show image')`),
     "those rows read \"show image\" too");
  ok((await evaluate(`document.querySelector('#imgNote').textContent`)).includes("logo  (card image)"),
     "the metadata row follows the choice");

  await evaluate(`(() => { const s=document.querySelector('#imageField'); s.value=''; s.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(300);
  ok(/[&?]img=(&|$)/.test(await evaluate("location.search")),
     "(none) is recorded as an empty value, not a sentinel word\n         got " + await evaluate("location.search"));
  ok(!(await evaluate("location.search")).includes("__none__"), "no __none__ anywhere");
  ok(await evaluate(`document.querySelectorAll('#cards .cardimg').length`) === 0, "no thumbnails at all");
  ok(await evaluate(`document.querySelectorAll('#cards .card.has-img').length`) === 0, "and no card claims to have one");

  /* the choice survives a reload */
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=image-test.json&img=logo`});
  await sleep(1500);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`document.querySelector('#imageField').value`) === "logo", "img= is restored from the URL");
  ok(await evaluate(`document.querySelectorAll('#cards .cardimg').length`) === 4, "with the thumbnails on that column");
  await evaluate(`(() => { const s=document.querySelector('#imageField'); s.value='portrait'; s.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(300);
  ok(await evaluate(`document.querySelector('#cards').innerHTML.includes('>homepage<')`),
     "a plain URL field is still a text row");
  ok((await evaluate(`document.querySelector('#metaBody').textContent`)).includes("portrait"),
     "the metadata panel names the image field");

  ok(await settle(VISIBLE, 2) === true,
     "the two unreachable remote URLs collapse their box instead of showing a broken icon");

  await settle(VISIBLE, 2);            // wait for the unreachable ones to give up first
  const box = await evaluate(`(() => {
    const els = [...document.querySelectorAll('#cards .cardimg')]
      .filter(e => getComputedStyle(e).display !== 'none');
    const r = els.map(e => { const s = getComputedStyle(e); const b = e.getBoundingClientRect();
      const i = getComputedStyle(e.querySelector('img'));
      return {w: Math.round(b.width), h: Math.round(b.height), radius: s.borderRadius,
              fit: i.objectFit, pos: i.objectPosition,
              lazy: e.querySelector('img').loading,
              ref: e.querySelector('img').referrerPolicy}; });
    return JSON.stringify(r);
  })()`);
  const boxes = JSON.parse(box);
  ok(boxes.length === 2, "two thumbnails actually rendered");
  ok(boxes.every(b => b.w === b.h), "every thumbnail is square: " + JSON.stringify(boxes[0]));
  ok(new Set(boxes.map(b => b.w)).size === 1, "identical size on every record (" + boxes[0].w + "px)");
  ok(boxes.every(b => b.fit === "cover"), "the picture fills the square (object-fit: cover)");
  ok(boxes.every(b => b.radius === "10px"), "corners are rounded");
  ok(boxes.every(b => b.pos === "50% 0%"), "the crop is anchored to the top of the source image");
  ok(boxes.every(b => b.lazy === "lazy"), "off-screen thumbnails are lazily fetched");
  ok(boxes.every(b => b.ref === "no-referrer"), "no referrer is sent to the image host");

  /* the tall source image must show its top half and none of its bottom half */
  const crop = JSON.parse(await evaluate(`(() => {
    const img = [...document.querySelectorAll('#cards .cardimg img')]
      .find(i => i.naturalHeight > i.naturalWidth);
    const box = img.getBoundingClientRect();
    const scale = box.width / img.naturalWidth;          // cover: width fills the square
    return JSON.stringify({nat: [img.naturalWidth, img.naturalHeight],
                           visible: Math.round(box.height / scale),   // source px actually shown
                           complete: img.complete});
  })()`));
  ok(crop.complete, "the tall source image decoded");
  ok(crop.nat[1] === 2 * crop.nat[0], "the fixture image really is 1:2 " + JSON.stringify(crop.nat));
  ok(crop.visible === crop.nat[0],
     `only the top ${crop.visible} of ${crop.nat[1]} source rows are shown — the bottom half is cropped away`);

  /* responsive: the same square shrinks with the viewport, within bounds */
  await send("Emulation.setDeviceMetricsOverride", {width: 420, height: 900, deviceScaleFactor: 1, mobile: false});
  await sleep(300);
  const narrow = await evaluate(`Math.round(document.querySelector('#cards .cardimg').getBoundingClientRect().width)`);
  await send("Emulation.setDeviceMetricsOverride", {width: 2200, height: 900, deviceScaleFactor: 1, mobile: false});
  await sleep(300);
  const wide = await evaluate(`Math.round(document.querySelector('#cards .cardimg').getBoundingClientRect().width)`);
  await send("Emulation.clearDeviceMetricsOverride", {});
  ok(narrow === 43 && wide === 80, `size tracks the viewport between its bounds (${narrow}px … ${wide}px)`);

  console.log("\n== card layout: picture beside the title, rows full width ==");
  const geo = () => evaluate(`(() => {
    const card = document.querySelector('#cards .card.has-img');
    const cs = getComputedStyle(card), c = card.getBoundingClientRect();
    const i = card.querySelector('.cardimg').getBoundingClientRect();
    const h = card.querySelector('h3').getBoundingClientRect();
    const rows = [...card.querySelectorAll('.kv')].map(e => e.getBoundingClientRect());
    return JSON.stringify({
      imgTop: Math.round(i.top), imgBottom: Math.round(i.bottom),
      imgLeft: Math.round(i.left), imgRight: Math.round(i.right),
      headTop: Math.round(h.top), headBottom: Math.round(h.bottom),
      headLeft: Math.round(h.left), headRight: Math.round(h.right),
      rowTop: Math.round(rows[0].top),
      rowLeft: Math.round(Math.min(...rows.map(r => r.left))),
      rowRight: Math.round(Math.max(...rows.map(r => r.right))),
      rowWidths: [...new Set(rows.map(r => Math.round(r.width)))],
      innerTop: Math.round(c.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop)),
      innerLeft: Math.round(c.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)),
      innerRight: Math.round(c.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight)),
      innerWidth: Math.round(c.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
                             - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))});
  })()`).then(JSON.parse);

  let g = await geo();
  ok(g.headTop === g.innerTop, `the title is on the top line (${g.headTop} vs ${g.innerTop})`);
  ok(g.imgTop >= g.headTop, "nothing sits above the title — the picture starts level with it or lower");
  ok(g.imgTop === g.innerTop, "the picture is also on the top line, beside the title");
  ok(g.imgTop < g.headBottom && g.headTop < g.imgBottom, "title and picture overlap vertically — one line, not stacked");
  ok(g.headLeft === g.innerLeft, "the title is flush left");
  ok(g.imgRight === g.innerRight, "the picture is flush right");
  ok(g.headRight <= g.imgLeft, `the title never runs under the picture (title ends ${g.headRight}, img starts ${g.imgLeft})`);
  ok(g.rowTop >= g.imgBottom, `the detail rows start below the picture (rows at ${g.rowTop}, img ends ${g.imgBottom})`);
  ok(g.rowWidths.length === 1 && g.rowWidths[0] === g.innerWidth,
     `every detail row spans the whole card width (${JSON.stringify(g.rowWidths)} of ${g.innerWidth})`);
  ok(g.rowLeft === g.innerLeft && g.rowRight === g.innerRight, "flush with both card edges");

  await evaluate(`(() => { const v=document.querySelector('#viewMode'); v.value='full'; v.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(300);
  g = await geo();
  ok(g.imgRight === g.innerRight && g.imgTop === g.innerTop, "full-width view: picture top-right of the row");
  ok(g.headTop === g.innerTop && g.headLeft === g.innerLeft, "title still leads the row");
  ok(g.rowTop >= g.imgBottom, "and the fields wrap underneath, clear of the picture");
  await evaluate(`(() => { const v=document.querySelector('#viewMode'); v.value='cards'; v.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(300);

  await evaluate(`document.querySelector('[data-fieldtog="portrait"]').click()`);
  await sleep(300);
  ok(await evaluate(`document.querySelectorAll('#cards .cardimg').length`) === 0,
     "switching the image field off removes the thumbnails");
  ok(/[&?]h=(.*,)?portrait(,|$)/.test(await evaluate("location.search")), "and it is in the URL like any other field");
  ok((await evaluate(`document.querySelector('#imgNote').textContent`)).includes("switched off"),
     "the metadata row says so");
  await evaluate(`document.querySelector('[data-fieldtog="portrait"]').click()`);
  await sleep(300);
  ok(await evaluate(`document.querySelectorAll('#cards .cardimg').length`) === 4, "switching it back on restores them");

  console.log("\n== double-click a nested field's triangle ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=link-test.json&ps=all`});
  await sleep(1500);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards details.cf').length`)) break;
    await sleep(200);
  }
  const count = f => evaluate(`[...document.querySelectorAll('#cards details.cf')]
      .filter(d => d.dataset.field === '${f}').length`);
  const openCount = f => evaluate(`[...document.querySelectorAll('#cards details.cf')]
      .filter(d => d.dataset.field === '${f}' && d.open).length`);
  const rendered = f => evaluate(`[...document.querySelectorAll('#cards details.cf')]
      .filter(d => d.dataset.field === '${f}')
      .every(d => d.querySelector('.cf-body').dataset.rendered === '1'
                  && d.querySelector('.cf-body').innerHTML.length > 0)`);

  ok(await count("refs") === 4, "the fixture has a refs expander on 4 cards");
  ok(await count("works") === 2, "and a works expander on 2");
  ok(await openCount("refs") === 0, "all closed to begin with");

  /* a real double-click: two press/release pairs, so the page sees click, click, dblclick */
  async function dblclick(field, nth = 0){
    const at = JSON.parse(await evaluate(`(() => {
      const d = [...document.querySelectorAll('#cards details.cf')]
        .filter(x => x.dataset.field === '${field}')[${nth}];
      d.scrollIntoView({block: 'center'});
      const r = d.querySelector('summary').getBoundingClientRect();
      return JSON.stringify({x: Math.round(r.left + 8), y: Math.round(r.top + r.height / 2)});
    })()`));
    for(const clickCount of [1, 2]){
      for(const type of ["mousePressed", "mouseReleased"])
        await send("Input.dispatchMouseEvent", {type, x: at.x, y: at.y, button: "left", clickCount});
    }
    await sleep(400);
  }

  await dblclick("refs");
  ok(await openCount("refs") === 4, `all 4 refs expanders open (got ${await openCount("refs")})`);
  ok(await rendered("refs"), "and every one of them rendered its body");
  ok(await openCount("works") === 0, "the other nested field is untouched");
  ok(await evaluate(`[...document.querySelectorAll('#cards details.cf')]
        .filter(d => d.dataset.field === 'refs')
        .every(d => d.querySelector('.cf-body a'))`),
     "the lazily-rendered bodies contain their resolved links");

  await dblclick("works");
  ok(await openCount("works") === 2, "double-clicking the other field opens that one");
  ok(await openCount("refs") === 4, "without closing the first");

  await dblclick("refs", 2);            // a different card of the same field closes them all
  ok(await openCount("refs") === 0, "double-clicking again closes every card's refs");
  ok(await openCount("works") === 2, "and still leaves works alone");

  /* a single click must keep behaving as a single click */
  await evaluate(`[...document.querySelectorAll('#cards details.cf')]
      .filter(d => d.dataset.field === 'refs')[0].querySelector('summary').click()`);
  await sleep(300);
  ok(await openCount("refs") === 1, "one click still opens just that one");

  console.log("\n== last-word sorting on a `name` field ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=sort-test.json&ps=all`});
  await sleep(1500);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  const titles = () => evaluate(`[...document.querySelectorAll('#cards .card h3')].map(h => h.textContent.trim())`);
  const opts = await evaluate(`[...document.querySelectorAll('#sortField option')].map(o => o.textContent)`);
  ok(opts.filter(o => o.startsWith("name")).join(" / ") === "name ▴ / name ▾ / name (last word) ▴ / name (last word) ▾",
     "the name field gets two extra options: " + opts.filter(o => o.startsWith("name")).join(" / "));
  ok(opts.filter(o => o.startsWith("field")).length === 2, "an ordinary field still gets exactly two");
  ok(opts.filter(o => o.startsWith("born")).length === 2, "and so does a numeric one");

  const pickSort = (f, desc = false, last = false) => evaluate(`(() => { const s = document.querySelector('#sortField');
      s.selectedIndex = [...s.options].findIndex(o => o.value === '${f}'
        && (o.dataset.desc === '1') === ${desc} && (o.dataset.last === '1') === ${last});
      s.dispatchEvent(new Event('change', {bubbles: true})); })()`).then(() => sleep(300));

  await pickSort("name");
  ok(JSON.stringify(await titles()) === JSON.stringify(
       ["Ada Lovelace","Alan Turing","Ann Smith","Grace Hopper","John Smith","John von Neumann","Madonna","(untitled)"]),
     "plain ascending sorts by the whole name: " + (await titles()).slice(0, 3).join(", "));

  await pickSort("name", false, true);
  const surname = await titles();
  ok(JSON.stringify(surname) === JSON.stringify(
       ["Grace Hopper","Ada Lovelace","Madonna","John von Neumann","Ann Smith","John Smith","Alan Turing","(untitled)"]),
     "by last word: " + surname.join(", "));
  ok(surname.indexOf("Ann Smith") < surname.indexOf("John Smith"),
     "two Smiths fall back to the whole name");
  ok(surname[2] === "Madonna", "a one-word name sorts on itself");
  ok(surname[3] === "John von Neumann", "a multi-part surname sorts on its last word");
  ok(surname[surname.length - 1] === "(untitled)", "the record with no name sorts last");
  let u = await evaluate("location.search");
  ok(u.includes("sla=name") && !u.includes("sld="),
     "last-word ascending is sla=\n         got " + u);

  await pickSort("name", true, true);
  const surnameDesc = await titles();
  ok(JSON.stringify(surnameDesc.slice(0, 7)) === JSON.stringify([...surname.slice(0, 7)].reverse()),
     "descending by last word mirrors it: " + surnameDesc.slice(0, 3).join(", "));
  ok(surnameDesc[surnameDesc.length - 1] === "(untitled)", "and the nameless record is still last");
  u = await evaluate("location.search");
  ok(u.includes("sld=name") && !u.includes("sla="), "and descending is sld=\n         got " + u);

  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=sort-test.json&ps=all&sort=name&last=1`});
  await sleep(1500);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`document.querySelector('#sortField').selectedOptions[0].textContent`) === "name (last word) ▴",
     "a shared link restores the last-word mode");
  ok(JSON.stringify(await titles()) === JSON.stringify(surname), "with the same order");

  /* the flag is meaningless on any other field and must be ignored, not obeyed */
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=sort-test.json&ps=all&sort=field&last=1`});
  await sleep(1500);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`document.querySelector('#sortField').selectedOptions[0].textContent`) === "field ▴",
     "last=1 on a non-name field degrades to the ordinary ascending sort");

  console.log("\n== long text fields as full-width expanders ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=text-test.json`});
  await sleep(1200);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  const rowKeys = () => evaluate(`[...new Set([...document.querySelectorAll('#cards .kv .k')]
      .map(e => e.textContent))]`);
  const expKeys = () => evaluate(`[...new Set([...document.querySelectorAll('#cards details.cf')]
      .map(d => d.dataset.field))]`);

  ok(JSON.stringify(await expKeys()) === '["abstract"]',
     "only the wordy column becomes an expander: " + JSON.stringify(await expKeys()));
  ok(JSON.stringify((await rowKeys()).sort()) === '["author","journal","note","year"]',
     "the short columns stay ordinary rows: " + JSON.stringify((await rowKeys()).sort()));
  ok(await evaluate(`document.querySelectorAll('#cards details.cf.txt').length`) === 4,
     "one per record that actually has the text — not the record without an abstract");
  ok(await evaluate(`!document.querySelector('#cards').innerHTML.includes('linear programming')`),
     "the prose is not rendered until opened — only the opening words appear as a teaser");

  console.log("  -- the teaser --");
  const peek = await evaluate(`document.querySelector('#cards details.cf.txt .peek').textContent`);
  ok(peek.length <= 71 && peek.endsWith("…"), `a preview sits beside the collapsed triangle: ${JSON.stringify(peek)}`);
  ok(await evaluate(`document.querySelector('#cards details.cf.txt summary').textContent.startsWith('abstract')`),
     "after the field name");

  console.log("  -- opening one --");
  await evaluate(`document.querySelector('#cards details.cf.txt summary').click()`);
  await sleep(300);
  const open = JSON.parse(await evaluate(`(() => {
    const d = document.querySelector('#cards details.cf.txt');
    const body = d.querySelector('.cf-body'), card = d.closest('.card');
    const b = body.getBoundingClientRect(), c = card.getBoundingClientRect();
    const cs = getComputedStyle(card), row = card.querySelector('.kv .v');
    return JSON.stringify({
      text: body.textContent.slice(0, 30),
      rendered: body.dataset.rendered,
      width: Math.round(b.width),
      inner: Math.round(c.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
                        - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      valueColumn: Math.round(row.getBoundingClientRect().width),
      peekHidden: getComputedStyle(d.querySelector('.peek')).display === 'none',
      wrap: getComputedStyle(body).whiteSpace
    });
  })()`));
  ok(open.rendered === "1" && open.text.startsWith("We study identification"), "the text renders lazily on open");
  ok(open.width === open.inner, `and spans the full card width (${open.width} of ${open.inner})`);
  ok(open.width > open.valueColumn * 1.5,
     `far wider than a key/value row would give it (${open.width} vs ${open.valueColumn})`);
  ok(open.peekHidden, "the teaser gives way to the full text");
  ok(open.wrap === "normal", "newlines in the source are ordinary whitespace, not layout");

  console.log("  -- it behaves like the array expanders --");
  await evaluate(`document.querySelector('#cards details.cf.txt summary').click()`);
  await sleep(200);
  const at = JSON.parse(await evaluate(`(() => {
    const d = document.querySelector('#cards details.cf.txt');
    d.scrollIntoView({block: 'center'});
    const r = d.querySelector('summary').getBoundingClientRect();
    return JSON.stringify({x: Math.round(r.left + 8), y: Math.round(r.top + r.height / 2)});
  })()`));
  for(const clickCount of [1, 2])
    for(const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", {type, x: at.x, y: at.y, button: "left", clickCount});
  await sleep(400);
  ok(await evaluate(`[...document.querySelectorAll('#cards details.cf.txt')].every(d => d.open)`),
     "double-click opens the field on every card, as it does for arrays");

  console.log("  -- and like any other field --");
  await evaluate(`document.querySelector('[data-fieldtog="abstract"]').click()`);
  await sleep(300);
  ok(await evaluate(`document.querySelectorAll('#cards details.cf').length`) === 0,
     "switching the column off removes the expanders");
  ok(/[&?]h=(.*,)?abstract(,|$)/.test(await evaluate("location.search")), "with the usual URL parameter");
  await evaluate(`document.querySelector('[data-fieldtog="abstract"]').click()`);
  await sleep(300);
  ok(await evaluate(`document.querySelectorAll('#cards details.cf.txt').length`) === 4, "and switching it back on restores them");
  ok(await evaluate(`[...document.querySelectorAll('#sortField option')].some(o => o.value === 'abstract')`),
     "a long-text column is still sortable and filterable like any scalar field");
  ok(await evaluate(`document.querySelector('.ffield[data-field="abstract"]') !== null`), "its filter panel is there too");

  console.log("  -- full-width view prints them in place --");
  await evaluate(`(() => { const v=document.querySelector('#viewMode'); v.value='full'; v.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(400);
  ok(await evaluate(`document.querySelectorAll('#cards details.cf.txt').length`) === 0,
     "no expanders in a full-width row");
  ok(await evaluate(`document.querySelectorAll('#cards .lt').length`) === 4,
     "the text is printed in place instead, once per record that has it");
  ok(await evaluate(`document.querySelector('#cards').textContent.includes('linear programming')`),
     "so the prose is on screen without clicking anything");
  ok(await evaluate(`document.querySelector('#cards .lt-k').textContent`) === "abstract",
     "still labelled with the field name");

  const inplace = JSON.parse(await evaluate(`(() => {
    const v = document.querySelector('#cards .lt-v'), card = v.closest('.card');
    const cs = getComputedStyle(card), c = card.getBoundingClientRect();
    const inner = c.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
                          - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const wrap = document.querySelector('#cards .kvwrap');
    return JSON.stringify({
      text: Math.round(v.getBoundingClientRect().width),
      inner: Math.round(inner),
      wrapWidth: Math.round(wrap.getBoundingClientRect().width),
      belowRows: Math.round(v.getBoundingClientRect().top) >= Math.round(wrap.getBoundingClientRect().bottom),
      whiteSpace: getComputedStyle(v).whiteSpace
    });
  })()`));
  ok(inplace.text === inplace.inner,
     `the text takes the full width of the row (${inplace.text} of ${inplace.inner})`);
  ok(inplace.belowRows, "and sits below the inline key/value pairs, not among them");
  ok(inplace.whiteSpace === "normal", "and reflows as one paragraph here too");

  /* the fixture's second abstract contains \n\n and \n: they must not break lines */
  const reflow = JSON.parse(await evaluate(`(() => {
    const el = [...document.querySelectorAll('#cards .lt-v')]
      .find(e => e.textContent.includes('Faceted browsing'));
    const h = el.getBoundingClientRect().height;
    const probe = el.cloneNode(true);                       // same text, newlines spelled as spaces
    probe.textContent = el.textContent.replace(/\\s+/g, ' ');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:' + el.getBoundingClientRect().width + 'px';
    el.parentNode.appendChild(probe);
    const ph = probe.getBoundingClientRect().height;
    probe.remove();
    return JSON.stringify({rawHasNewlines: /\\n/.test(el.textContent), height: Math.round(h), flat: Math.round(ph)});
  })()`));
  ok(reflow.rawHasNewlines, "the value really does contain newlines");
  ok(Math.abs(reflow.height - reflow.flat) <= 2,
     `and renders to the same height as the same text without them (${reflow.height} vs ${reflow.flat})`);

  await evaluate(`(() => { const v=document.querySelector('#viewMode'); v.value='cards'; v.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await sleep(400);
  ok(await evaluate(`document.querySelectorAll('#cards .lt').length`) === 0 &&
     await evaluate(`document.querySelectorAll('#cards details.cf.txt').length`) === 4,
     "switching back to cards restores the expanders");

  /* and it survives a reload of a shared full-width link */
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=text-test.json&view=full`});
  await sleep(1200);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok(await evaluate(`document.querySelectorAll('#cards .lt').length`) === 4 &&
     await evaluate(`document.querySelectorAll('#cards details.cf.txt').length`) === 0,
     "a ?view=full link opens straight into the printed-in-place layout");

  console.log("\n== OR: saved filter sets ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json`});
  await sleep(1200);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  const nRecords = () => evaluate(`+document.querySelector('#resCount').textContent.replace(/,/g,'')`);
  const clauses = () => evaluate(`[...document.querySelectorAll('#clauses .clause .cbits')].map(e => e.textContent.trim())`);
  const tick = (f, v) => evaluate(`(() => {
      const d = document.querySelector('.ffield[data-field="${f}"]'); d.open = true;
      return true; })()`).then(() => sleep(250))
    .then(() => evaluate(`document.querySelector('.ffield[data-field="${f}"] input[data-val="${v}"]').click()`))
    .then(() => sleep(300));

  ok(await evaluate(`document.querySelector('#orFilter') !== null`), "an OR button sits with the other filter actions");
  ok(await evaluate(`document.querySelector('#orFilter').disabled`),
     "disabled while there is nothing to save");
  ok((await clauses()).length === 0, "and no saved sets to begin with");

  const all = await nRecords();
  await tick("country", "United States");
  const us = await nRecords();
  ok(us < all && us > 0, `filtering to one country gives ${us} of ${all}`);
  ok(!(await evaluate(`document.querySelector('#orFilter').disabled`)), "now the button is live");

  console.log("  -- saving the first set --");
  await evaluate(`document.querySelector('#orFilter').click()`);
  await sleep(400);
  const saved = await clauses();
  ok(saved.length === 1 && saved[0].includes("country") && saved[0].includes("United States"),
     "the set is summarised above the fields: " + JSON.stringify(saved));
  ok(await evaluate(`document.querySelector('.ffield[data-field="country"]').dataset.active`) === "0",
     "and the panels are cleared, ready for the next set");
  ok(await nRecords() === us, "the result is unchanged — an empty panel adds nothing to the union");
  ok(await evaluate(`document.querySelector('#orFilter').disabled`), "the button goes quiet again");

  console.log("  -- the union --");
  await tick("country", "United Kingdom");
  const both = await nRecords();
  ok(both > us, `the live set adds to the saved one: ${us} -> ${both}`);
  ok(await evaluate(`[...document.querySelectorAll('#cards .kv')]
       .filter(r => r.querySelector('.k').textContent === 'country')
       .some(r => r.querySelector('.v').textContent === 'United States')`),
     "records from the saved set are still shown");
  ok(await evaluate(`[...document.querySelectorAll('#cards .kv')]
       .filter(r => r.querySelector('.k').textContent === 'country')
       .some(r => r.querySelector('.v').textContent === 'United Kingdom')`),
     "alongside records from the live one");

  let orUrl = await evaluate("location.search");
  ok(orUrl.includes("f1.country=United+States") && orUrl.includes("f.country=United+Kingdom"),
     "both are in the URL, the saved one numbered\n         got " + orUrl);

  console.log("  -- facets describe the set being built --");
  ok(await evaluate(`[...document.querySelectorAll('.ffield[data-field="country"] .vrow')]
       .some(r => r.querySelector('.vtxt').textContent === 'United States' &&
                  +r.querySelector('.vc').textContent > 0)`),
     "the panel still offers values covered by a saved set, with real counts");

  console.log("  -- each set shows its size and its removal cost --");
  const tots = () => evaluate(`[...document.querySelectorAll('#clauses .ctot')].map(e => +e.textContent.replace(/,/g,''))`);
  const dels = () => evaluate(`[...document.querySelectorAll('#clauses .cdel')].map(e => +e.textContent.replace(/[×,]/g,''))`);
  const tips = () => evaluate(`[...document.querySelectorAll('#clauses .cdel')].map(e => e.title)`);

  ok(JSON.stringify(await tots()) === JSON.stringify([us]),
     `the set reports how many records match it (${(await tots())[0]} for ${us})`);
  ok(JSON.stringify(await dels()) === JSON.stringify([us]),
     "and, with nothing overlapping it, the same number would be lost on removal");
  ok(await evaluate(`document.querySelector('#clauses .cdel').textContent.startsWith('×')`),
     "the removal cost is marked with ×");

  /* a second, disjoint set: neither overlaps, so both numbers stay equal */
  await evaluate(`document.querySelector('#orFilter').click()`);
  await sleep(400);
  const t2 = await tots(), d2 = await dels();
  ok(t2.length === 2 && JSON.stringify(t2) === JSON.stringify(d2),
     "disjoint sets: matches and removal cost agree — " + JSON.stringify(t2));
  ok(t2[0] + t2[1] === both, `and they account for the whole result (${t2[0]} + ${t2[1]} = ${both})`);

  /* cover one of them from the panels: its size is unchanged, its removal cost falls to zero */
  await tick("country", "United States");
  ok(JSON.stringify(await tots()) === JSON.stringify(t2),
     "matching a set live does not change how many records it matches");
  ok((await dels())[0] === 0,
     `but removing it would now cost nothing (${(await dels())[0]})`);
  ok((await tips())[0].includes("shown by another filter too"), "and the tooltip says why");
  ok(await nRecords() === both, "while the result itself is unchanged");
  await tick("country", "United States");
  ok((await dels())[0] === t2[0], "unticking restores the cost");

  /* overlapping sets: sizes overlap, costs do not */
  await evaluate(`document.querySelector('#clauses .cx').click()`);
  await sleep(300);
  await evaluate(`document.querySelector('#clauses .cx').click()`);
  await sleep(300);
  await tick("country", "United States");
  await evaluate(`document.querySelector('#orFilter').click()`);
  await sleep(400);
  await tick("category", "economics_dept");
  await evaluate(`document.querySelector('#orFilter').click()`);
  await sleep(400);
  const ot = await tots(), od = await dels(), shown = await nRecords();
  ok(ot.length === 2 && od.length === 2, "two overlapping sets, two pairs of numbers");
  ok(od[0] < ot[0] && od[1] < ot[1],
     `each costs less to remove than it matches — ${ot[0]}/×${od[0]} and ${ot[1]}/×${od[1]}`);
  ok(od[0] + od[1] < shown, `removal costs do not double-count the overlap (${od[0]} + ${od[1]} < ${shown})`);
  ok(ot[0] + ot[1] > shown, `while the match counts do overlap (${ot[0]} + ${ot[1]} > ${shown})`);
  ok(ot[0] - od[0] === ot[1] - od[1],
     "the shared records are the same set counted from either side: " + (ot[0] - od[0]));

  await evaluate(`document.querySelector('#resetFilters').click()`);
  await sleep(300);
  await tick("country", "United States");
  await evaluate(`document.querySelector('#orFilter').click()`);
  await sleep(400);
  await tick("country", "United Kingdom");
  await evaluate(`document.querySelector('#orFilter').click()`);
  await sleep(400);

  console.log("  -- a second saved set, then removal --");
  await evaluate(`document.querySelector('#orFilter').click()`);
  await sleep(400);
  ok((await clauses()).length === 2, "two sets saved");
  ok(await nRecords() === both, "and the union is unchanged by saving");

  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html` + orUrl});
  await sleep(1400);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  ok((await clauses()).length === 1 && await nRecords() === both,
     "a shared link rebuilds the saved set and reproduces the same union");

  await evaluate(`document.querySelector('#clauses .cx').click()`);
  await sleep(400);
  ok((await clauses()).length === 0, "the ✕ removes a saved set");
  const ukOnly = await nRecords();
  ok(ukOnly < both && ukOnly > 0, `leaving only the live set: ${both} -> ${ukOnly}`);
  ok(!(await evaluate("location.search")).includes("f1."), "and it leaves the URL");

  console.log("  -- search and reset --");
  await evaluate(`document.querySelector('#orFilter').click()`);
  await sleep(300);
  await evaluate(`const s=document.querySelector('#globalSearch'); s.value='london'; s.dispatchEvent(new Event('input'))`);
  await sleep(400);
  const searched = await nRecords();
  ok(searched > 0 && searched < ukOnly, `the search narrows the whole union (${ukOnly} -> ${searched})`);
  ok((await clauses())[0] && !(await clauses())[0].includes("london"), "without being captured into the set");

  await evaluate(`document.querySelector('#resetFilters').click()`);
  await sleep(400);
  ok((await clauses()).length === 0 && await nRecords() === all,
     "Reset filters clears saved sets, live filters and the search alike");

  console.log("\n== the pager is there only when there is paging to do ==");
  const pagerUp = () => evaluate(`getComputedStyle(document.querySelector('.pager')).display!=='none'`);
  ok(await pagerUp(), "379 records at 100 a page: four pages, so the arrows are up");
  await evaluate(`(()=>{const s=document.querySelector('#pageSize');
     s.value='500'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(400);
  ok(!(await pagerUp()), "a page size that takes them all leaves nothing to page through");
  ok(await evaluate(`document.querySelectorAll('#cards .card').length`)===379,
     "though every record is still on screen");
  await evaluate(`(()=>{const s=document.querySelector('#pageSize');
     s.value='100'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(400);
  ok(await pagerUp(), "narrowing the page brings them back");
  await evaluate(`(()=>{const i=document.querySelector('#globalSearch');
     i.value='oxford'; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(500);
  ok(await evaluate(`+document.querySelector('#resCount').textContent.replace(/,/g,'')`)<100,
     "a search that leaves under a page of records");
  ok(!(await pagerUp()), "takes the pager away too — one page is one page, however it got there");
  await evaluate(`(()=>{const i=document.querySelector('#globalSearch');
     i.value=''; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(500);
  ok(await pagerUp(), "and clearing it restores them");

  console.log("\n== a metadata wrapper object is not an indentation layer ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=text-test.json`});
  await sleep(1200);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  const metaKeys = () => evaluate(`[...document.querySelectorAll('#metaBody > .kv > .k')].map(e => e.textContent)`);
  const keys = await metaKeys();
  ok(keys.includes("compiled_by") && keys.includes("compiled_on"),
     "the wrapper's entries appear as first-level rows: " + JSON.stringify(keys.slice(-6)));
  ok(!keys.includes("metadata"), "and the wrapper itself contributes no row of its own");
  ok(await evaluate(`[...document.querySelectorAll('#metaBody > .kv')]
       .filter(r => r.querySelector('.k').textContent === 'compiled_by')
       .every(r => r.querySelector('.obj') === null)`),
     "so they are plain rows, not a nested block");
  ok(await evaluate(`(() => {
       const rows = [...document.querySelectorAll('#metaBody > .kv > .k')];
       const a = rows.find(e => e.textContent === 'records');
       const b = rows.find(e => e.textContent === 'compiled_by');
       return Math.abs(a.getBoundingClientRect().left - b.getBoundingClientRect().left) < 1;
     })()`), "flush with the rows the viewer generates itself");
  ok(await evaluate(`document.querySelector('#metaBody').textContent.includes('json-browser test fixture')`),
     "with their values intact");

  /* one layer only: an object inside the wrapper still nests */
  ok(keys.includes("nested"), "a deeper object keeps its own row");
  ok(await evaluate(`[...document.querySelectorAll('#metaBody > .kv')]
       .filter(r => r.querySelector('.k').textContent === 'nested')
       .every(r => r.querySelector('.obj .k') !== null)`),
     "and still renders indented beneath it — only the wrapper is flattened");

  console.log("\n== the panel folds away for small screens ==");
  await send("Page.navigate", {url: `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json`});
  await sleep(1200);
  for(let i = 0; i < 60; i++){
    if(await evaluate(`document.querySelectorAll('#cards .card').length`)) break;
    await sleep(200);
  }
  const shot = () => evaluate(`(() => {
    const side = document.querySelector('aside.side'), card = document.querySelector('#cards .card');
    return JSON.stringify({
      panelShown: getComputedStyle(side).display !== 'none',
      expanded: document.querySelector('#sideToggle').getAttribute('aria-expanded'),
      main: Math.round(document.querySelector('.main').clientWidth),
      card: card ? Math.round(card.getBoundingClientRect().width) : 0,
      pageScrolls: document.body.scrollWidth > window.innerWidth + 1,
      header: Math.round(document.querySelector('header.top').getBoundingClientRect().width),
      titleLines: Math.round(document.querySelector('header.top h1').getBoundingClientRect().height),
      stacked: getComputedStyle(document.querySelector('.app')).gridTemplateAreas.includes('"top"')
    });
  })()`).then(JSON.parse);
  const viewport = (w, h = 900) => send("Emulation.setDeviceMetricsOverride",
      {width: w, height: h, deviceScaleFactor: 1, mobile: false}).then(() => sleep(400));
  const toggle = () => evaluate(`document.querySelector('#sideToggle').click()`).then(() => sleep(300));

  await viewport(1400);
  let s = await shot();
  ok(s.panelShown && s.expanded === "true", "on a desktop the panel starts open");
  const openMain = s.main;
  await toggle();
  s = await shot();
  ok(!s.panelShown && s.expanded === "false", "the header button folds it away");
  ok(s.main > openMain + 250, `and the records take the freed width (${openMain} -> ${s.main}px)`);
  await toggle();
  ok((await shot()).panelShown, "clicking again brings it back");

  console.log("  -- on a phone --");
  await viewport(420);
  s = await shot();
  ok(!s.panelShown && s.expanded === "false", "it starts folded away, so the records get the screen");
  ok(s.card > 300, `each card is readable rather than a sliver (${s.card}px wide)`);
  ok(!s.pageScrolls, "and the page does not scroll sideways");
  ok(s.header >= 419, `the header spans the screen rather than being crushed into a column (${s.header}px)`);
  ok(s.titleLines < 40, `so the title stays on one line instead of stacking word by word (${s.titleLines}px tall)`);
  await toggle();
  s = await shot();
  ok(s.panelShown, "tapping the button reveals it");
  ok(s.stacked, "stacked above the records rather than squeezing them into a column");
  ok(await evaluate(`document.querySelector('#sortField') !== null &&
       getComputedStyle(document.querySelector('#sortField')).display !== 'none'`),
     "with the sort, filter and display controls all reachable");
  ok(!(await shot()).pageScrolls, "still no sideways scrolling");
  await toggle();

  console.log("  -- crossing the breakpoint --");
  await viewport(1400);
  ok((await shot()).panelShown, "widening the window brings the panel back automatically");
  await viewport(420);
  ok(!(await shot()).panelShown, "and narrowing it folds it away again");
  await send("Emulation.clearDeviceMetricsOverride", {});

  clearTimeout(watchdog);
  ws.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
