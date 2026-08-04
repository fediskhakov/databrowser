/* Drives the real page against deliberately hostile JSON: a primitive among the
   records, a __proto__ field name, an empty field name, arrays of mixed type. */
const { spawn } = require("child_process");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2], CDP = 9342;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(chromeBin(),
  ["--headless", "--disable-gpu", `--remote-debugging-port=${CDP}`, "--window-size=1400,900",
   "--user-data-dir=" + profileDir("messy"),
   `http://127.0.0.1:${PORT}/json-browser.html?file=messy-test.json`], {stdio: "ignore"});

let pass = 0, fail = 0;
const ok = (c, m) => { if(c) pass++; else { fail++; console.log("  FAIL " + m); } };

(async () => {
  let tg = null;
  for(let i = 0; i < 100 && !tg; i++){ await sleep(200);
    try { tg = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json())
                 .find(x => x.type === "page" && x.url.includes("json-browser")); } catch(e) {}
  }
  const ws = new WebSocket(tg.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if(m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if(m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (mth, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({id: i, method: mth, params: p})); });
  const ev = async e => (await send("Runtime.evaluate", {expression: e, returnByValue: true})).result.result.value;
  await send("Runtime.enable", {});

  for(let i = 0; i < 60; i++){ if(await ev(`document.querySelectorAll('#cards .card').length`)) break; await sleep(200); }

  console.log("\n== it loads at all ==");
  const cards = await ev(`document.querySelectorAll('#cards .card').length`);
  ok(cards === 6, `every record renders, primitives included (${cards} cards)`);
  ok(await ev(`document.querySelector('#emptyState').style.display`) !== "block",
     "not the silent 'No JSON loaded' fallback a thrown error used to produce");
  ok(await ev(`+document.querySelector('#resCount').textContent`) === 6, "and all six are counted");

  console.log("\n== a field named __proto__ ==");
  ok(await ev(`[...document.querySelectorAll('#metaBody .ftog')].some(e => e.textContent === '__proto__')`),
     "it is listed as an ordinary field");
  ok(!(await ev(`document.querySelector('#metaBody').textContent`)).includes("[object Object]"),
     "its counts are numbers, not [object Object]");
  ok(await ev(`Object.getPrototypeOf(state.meta)===null && typeof state.missCount["__proto__"]==="number"`),
     "the lookup tables keep a null prototype, so __proto__ is just a key");
  /* its object value is unpacked by the metadata-wrapper rule, exactly as any other
     object-valued metadata key would be — that is the documented behaviour, not leakage */
  ok(await ev(`Object.keys(state.meta).includes("__proto__")`),
     "and the key itself survives as an ordinary own property");

  /* The two bugs the earlier assertions walked straight past: presence tested with
     `k in r` reports Object.prototype as the value of every record WITHOUT the key,
     and a clause table keyed with a plain {} takes __proto__ as its prototype
     instead of a key. Only opening the panel and pressing OR reaches them. */
  console.log("\n== __proto__ as a field you can actually filter on ==");
  await ev(`document.querySelector('.ffield[data-field="__proto__"]').open = true`);
  await sleep(300);
  const pvals = await ev(`JSON.stringify([...document.querySelectorAll('.ffield[data-field="__proto__"] .vtxt')]
                            .map(e => e.textContent))`);
  ok(JSON.parse(pvals).length === 2, `only the two real values are offered: ${pvals}`);
  ok(!pvals.includes("[object Object]"),
     "no phantom value from the record that has no __proto__ key");
  ok(await ev(`state.presCount["__proto__"]`) === 2 && await ev(`state.missCount["__proto__"]`) === 4,
     "two records have it, four do not — counted by own property, not by inheritance");
  await ev(`document.querySelector('.ffield[data-field="__proto__"] input[data-val="proto-again"]').click()`);
  await sleep(350);
  ok(await ev(`+document.querySelector('#resCount').textContent`) === 1,
     "filtering on it selects the one record");

  console.log("\n== and one you can save as an OR set ==");
  ok(await ev(`!document.querySelector('#orFilter').disabled`), "OR is offered");
  await ev(`document.querySelector('#orFilter').click()`);
  await sleep(400);
  ok(await ev(`state.clauses.length`) === 1, "the set is saved");
  ok(await ev(`JSON.stringify(state.clauses[0].terms.map(t => t[0]))`) === '["__proto__"]',
     "on the field itself — not on a phantom field named 0, its prototype's indices");
  ok(await ev(`+document.querySelector('#resCount').textContent`) === 1,
     "and it still matches its one record");
  const purl = await ev(`decodeURIComponent(location.search)`);
  ok(purl.includes("f1.__proto__=proto-again"), `the URL names the field: ${purl}`);
  /* reloading is where the restore path took the same wrong turn */
  await send("Page.navigate", {url: await ev(`location.href`)});
  for(let i = 0; i < 60; i++){ await sleep(200);
    if(await ev(`typeof state !== 'undefined' && document.querySelectorAll('#cards .card').length`)) break; }
  ok(await ev(`state.clauses.length`) === 1 && await ev(`+document.querySelector('#resCount').textContent`) === 1,
     "and the link reopens to the same one record");
  ok(await ev(`document.querySelector('#emptyState').style.display`) !== "block",
     "with no 'No JSON loaded' laid over the cards");
  await ev(`state.clauses=[]; renderClauses(); apply()`);
  await sleep(300);

  console.log("\n== filtering and sorting over the messy set ==");
  await ev(`document.querySelector('.ffield[data-field="name"]').open = true`);
  await sleep(300);
  ok(await ev(`document.querySelectorAll('.ffield[data-field="name"] .vrow').length`) === 3,
     "the value list is built without tripping over the primitives");
  await ev(`document.querySelector('.ffield[data-field="name"] input[data-val="Alice"]').click()`);
  await sleep(300);
  ok(await ev(`+document.querySelector('#resCount').textContent`) === 1, "filtering works");
  await ev(`document.querySelector('.ffield[data-field="name"] input[data-val="Alice"]').click()`);
  await sleep(300);
  await ev(`(() => { const s=document.querySelector('#sortField');
      s.selectedIndex=[...s.options].findIndex(o=>o.value==='n');
      s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(400);
  ok(await ev(`+document.querySelector('#resCount').textContent`) === 6, "sorting keeps every record");

  console.log("\n== a mixed array in a nested field ==");
  await ev(`(() => { const d=[...document.querySelectorAll('#cards details.cf')][0]; if(d) d.open=true; })()`);
  await sleep(400);
  const body = await ev(`(() => { const d=document.querySelector('#cards details.cf[open] .cf-body');
                                  return d ? d.textContent : ""; })()`);
  ok(body.includes("T") && body.includes("loose"),
     `objects and loose values both render: ${JSON.stringify(body.slice(0, 60))}`);
  ok(!body.includes("[object Object]"), "with nothing stringified to [object Object]");

  console.log("\n== nothing threw along the way ==");
  ok(errors.length === 0, "no uncaught exceptions: " + JSON.stringify(errors.slice(0, 2)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
