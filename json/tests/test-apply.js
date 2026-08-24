/* apply() skips the work whose inputs have not changed. The contract is stated in
   state.stats — how many times it has actually filtered, faceted and sorted — so
   these are assertions rather than stopwatch readings: turning a page must re-sort
   nothing, and every real change must still be picked up. The second half is the
   one that matters, since a cache that never invalidates passes the first. */
const { spawn } = require("child_process");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2], CDP = 9354;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(chromeBin(),
  ["--headless","--disable-gpu",`--remote-debugging-port=${CDP}`,"--window-size=1400,900",
   "--user-data-dir=" + profileDir("apply"),
   `http://127.0.0.1:${PORT}/json-browser.html?file=econ_departments.json`],{stdio:"ignore"});
let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else { fail++; console.log("  FAIL "+m); } };
(async()=>{
  let tg=null;
  for(let i=0;i<100&&!tg;i++){ await sleep(200);
    try{ tg=(await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json())
            .find(x=>x.type==="page"&&x.url.includes("json-browser")); }catch(e){} }
  const ws=new WebSocket(tg.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener("open",r));
  let id=0; const pend=new Map(); const errors=[];
  ws.addEventListener("message",e=>{const m=JSON.parse(e.data);
    if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
  const send=(mth,p)=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:mth,params:p}));});
  const ev=async e=>(await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true})).result.result.value;
  await send("Runtime.enable",{});
  for(let i=0;i<60;i++){ if(await ev(`document.querySelectorAll('#cards .card').length`)) break; await sleep(200); }

  const stats = () => ev(`JSON.stringify(state.stats)`).then(JSON.parse);
  /* did the guarded work run between these two points? */
  const around = async fn => { const a=await stats(); await fn(); const b=await stats();
    return {filters:b.filters-a.filters, sorts:b.sorts-a.sorts, facets:b.facets-a.facets}; };
  const firstCard = () => ev(`document.querySelector('#cards .card h3').textContent.trim()`);

  await ev(`(()=>{const s=document.querySelector('#sortField');
             s.selectedIndex=[...s.options].findIndex(o=>o.textContent==='university ▴');
             s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(500);

  console.log("\n== paging does no work twice ==");
  let before = await firstCard();
  let d = await around(async()=>{ await ev(`document.querySelector('#next').click()`); await sleep(300); });
  ok(d.sorts===0 && d.filters===0 && d.facets===0,
     `turning a page re-sorts, re-filters and re-facets nothing: ${JSON.stringify(d)}`);
  ok(await firstCard() !== before, "while the cards on screen do change");
  d = await around(async()=>{ await ev(`document.querySelector('#prev').click()`); await sleep(300); });
  ok(d.sorts===0 && d.filters===0, "back again likewise");
  ok(await firstCard() === before, "landing on the same first record");
  d = await around(async()=>{ await ev(`document.querySelector('#last').click()`); await sleep(300);
                              await ev(`document.querySelector('#first').click()`); await sleep(300); });
  ok(d.sorts===0 && d.filters===0, "and the ends of the range too");

  console.log("\n== every real change is still picked up ==");
  const cases = [
    ["a value filter",      `document.querySelector('.ffield[data-field="country"]').open=true`, 0,
                            `document.querySelector('.ffield[data-field="country"] input[data-val="United States"]').click()`, "filters"],
    ["clearing it",         null, 0,
                            `document.querySelector('.ffield[data-field="country"] input[data-val="United States"]').click()`, "filters"],
    ["a search",            null, 0, `state.search='harvard'; apply()`, "filters"],
    ["clearing the search", null, 0, `state.search=''; apply()`, "filters"],
    ["switching a field off", null, 0,
                            `(()=>{const b=document.querySelector('[data-fieldtog="country"]');
                               b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true}));})()`, "filters"],
    ["switching it back on", null, 0,
                            `(()=>{const b=document.querySelector('[data-fieldtog="country"]');
                               b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true}));})()`, "filters"],
    ["changing the sort",   null, 0,
                            `(()=>{const s=document.querySelector('#sortField');
                               s.selectedIndex=[...s.options].findIndex(o=>o.textContent==='country ▴');
                               s.dispatchEvent(new Event('change',{bubbles:true}));})()`, "sorts"],
    ["reversing it",        null, 0,
                            `(()=>{const s=document.querySelector('#sortField');
                               s.selectedIndex=[...s.options].findIndex(o=>o.textContent==='country ▾');
                               s.dispatchEvent(new Event('change',{bubbles:true}));})()`, "sorts"],
    ["back to file order",  null, 0,
                            `(()=>{const s=document.querySelector('#sortField');
                               s.selectedIndex=0; s.dispatchEvent(new Event('change',{bubbles:true}));})()`, "sorts"],
  ];
  for(const [label,pre,, act,expect] of cases){
    if(pre){ await ev(pre); await sleep(300); }
    const dd = await around(async()=>{ await ev(act); await sleep(400); });
    ok(dd[expect]>0, `${label} is not skipped (${JSON.stringify(dd)})`);
    if(expect==="filters") ok(dd.sorts>0, `  ...and re-orders what it re-selected`);
  }

  console.log("\n== a filter change the signature could have missed ==");
  /* same number of selected values, different values: a signature counting sizes
     rather than spelling them out would call this unchanged */
  await ev(`document.querySelector('.ffield[data-field="country"] input[data-val="United States"]').click()`);
  await sleep(400);
  const usCount = await ev(`+document.querySelector('#resCount').textContent.replace(/,/g,'')`);
  d = await around(async()=>{
    await ev(`state.filters.country.vals.clear(); state.filters.country.vals.add("United Kingdom"); apply()`);
    await sleep(400); });
  ok(d.filters>0, "swapping one value for another re-filters");
  ok(await ev(`+document.querySelector('#resCount').textContent.replace(/,/g,'')`)!==usCount,
     "and the count follows");

  console.log("\n== saved sets and the record array ==");
  d = await around(async()=>{ await ev(`document.querySelector('#orFilter').click()`); await sleep(400); });
  ok(d.filters>0, "pressing OR re-filters");
  d = await around(async()=>{ await ev(`document.querySelector('#clauses .cx').click()`); await sleep(400); });
  ok(d.filters>0, "removing the set re-filters");
  d = await around(async()=>{ await ev(`setRecordSource(state.recordKey,true)`); await sleep(500); });
  ok(d.filters>0 && d.sorts>0, "and reloading the record array redoes everything");
  ok(errors.length===0, "no exceptions: "+JSON.stringify(errors.slice(0,2)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  ws.close(); chrome.kill(); process.exit(fail?1:0);
})().catch(e=>{console.error(e);chrome.kill();process.exit(1);});
