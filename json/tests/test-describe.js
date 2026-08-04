/* The button at the top of the filter pane that copies the filters in words. What
   matters is that the description can only ever describe what actually applied — a
   filter suspended with its field switched off must not appear in it — and that the
   saved OR sets are described as the union they are, not as one flat list. */
const { spawn } = require("child_process");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2], CDP = 9352;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(chromeBin(),
  ["--headless","--disable-gpu",`--remote-debugging-port=${CDP}`,"--window-size=1400,900",
   "--user-data-dir=" + profileDir("describe"),
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
  const ev=async (e,gesture)=>(await send("Runtime.evaluate",
    {expression:e,returnByValue:true,awaitPromise:true,userGesture:!!gesture})).result.result.value;
  await send("Runtime.enable",{});
  await send("Browser.grantPermissions",{permissions:["clipboardReadWrite","clipboardSanitizedWrite"]});
  for(let i=0;i<60;i++){ if(await ev(`document.querySelectorAll('#cards .card').length`)) break; await sleep(200); }
  const desc = () => ev(`describeFilters()`);

  console.log("\n== the button ==");
  ok(await ev(`!!document.querySelector('.side .actions #copyFilters')`),
     "it sits in the filter pane's button row");
  ok(await ev(`!document.querySelector('#copyFilters').disabled`),
     "and is never disabled — 'no filters' is a description too");
  ok(await ev(`document.querySelectorAll('#copyFilters svg rect').length`)===2,
     "carrying the copy glyph");
  ok(await ev(`!document.querySelector('#copyFilters svg text')`),
     "without a letter — the S and F ones are the lettered pair");

  console.log("\n== nothing set ==");
  let d = await desc();
  ok(d.split("\n")[0]==="econ_departments.json — 379 of 379 records",
     "the file and the counts head it\n         got "+JSON.stringify(d.split("\n")[0]));
  ok(d.includes("no filters — every record is shown"), "and it says so plainly");

  console.log("\n== the panels ==");
  await ev(`state.filters.country.vals.add("United States");
            state.filters.country.vals.add("Canada");
            state.filters.category.vals.add("economics_dept");
            state.filters.repec_url.present=true;
            renderClauses(); apply()`);
  await sleep(400);
  d = await desc();
  ok(d.split("\n")[0].startsWith("econ_departments.json — 90 of 379"), "the count follows the filters");
  ok(d.includes("\ncountry: United States or Canada"),
     "values within a field are joined with or — they are OR-ed\n         got "+JSON.stringify(d));
  ok(d.includes("\ncategory: economics_dept"), "each field on its own line — they are AND-ed");
  ok(d.includes("\nrepec_url: not missing"), "the presence flags are spelled out");
  ok(!d.includes("any of these sets"), "with no saved sets, nothing pretends there are any");

  console.log("\n== a suspended filter is not described ==");
  await ev(`(()=>{const b=document.querySelector('[data-fieldtog="category"]');
             b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(400);
  d = await desc();
  ok(!d.includes("category:"), "switching its field off drops it from the description");
  ok(!d.split("\n")[0].startsWith("econ_departments.json — 90 "),
     "as it drops out of the matching — the description can only describe what applied");
  await ev(`(()=>{const b=document.querySelector('[data-fieldtog="category"]');
             b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(400);
  ok((await desc()).includes("\ncategory: economics_dept"), "switching it back on restores it");

  console.log("\n== saved OR sets ==");
  await ev(`document.querySelector('#orFilter').click()`); await sleep(400);
  await ev(`state.filters.country.vals.add("United Kingdom"); renderClauses(); apply()`); await sleep(300);
  await ev(`document.querySelector('#orFilter').click()`); await sleep(400);
  await ev(`state.filters.repec_authors.present=true;
            state.search='school'; document.querySelector('#globalSearch').value='school';
            renderClauses(); apply()`);
  await sleep(500);
  d = await desc();
  ok(d.includes("\nsearch: school"), "the search is named");
  ok(d.includes("\nany of these sets:"), "the sets are introduced as a union, not a list of ANDs");
  ok(/\n  1\. country: United States or Canada, and category: economics_dept/.test(d),
     "set 1 keeps its number and its AND\n         got "+JSON.stringify(d));
  ok(/\n  2\. country: United Kingdom/.test(d), "set 2 likewise");
  ok(/\(\d+ records, \d+ only here\)/.test(d), "each carries the two counts the chips show");
  ok(/\n  3\. repec_authors: not missing   \(the panels, as they stand\)/.test(d),
     "and the panels are the last set, marked as such");
  const setsBefore = (d.match(/\n  \d\./g)||[]).length;
  ok(setsBefore===3, "three sets in all");

  console.log("\n== it copies what it describes ==");
  await ev(`document.querySelector('#copyFilters').click()`,true); await sleep(500);
  ok(await ev(`navigator.clipboard.readText()`)===await desc(),
     "the clipboard holds exactly the description");
  ok(await ev(`document.querySelector('#copyFilters').classList.contains('ok')`),
     "and the button confirms it");
  await sleep(1000);
  ok(!(await ev(`document.querySelector('#copyFilters').classList.contains('ok')`)),
     "the confirmation fades");
  ok(errors.length===0, "no exceptions: "+JSON.stringify(errors.slice(0,2)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  ws.close(); chrome.kill(); process.exit(fail?1:0);
})().catch(e=>{console.error(e);chrome.kill();process.exit(1);});
