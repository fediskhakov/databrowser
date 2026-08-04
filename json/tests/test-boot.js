/* Two things that only the real boot sequence can show: what happens when the file
   named in ?file= never arrives, and that "all" on a filter panel means every value
   the panel offers rather than the 1000 rows it draws. Both were silent failures —
   a blank page indistinguishable from having been given no link, and a bulk toggle
   that stopped at the cap without saying so. */
const { spawn } = require("child_process");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2], CDP = 9353;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(chromeBin(),
  ["--headless","--disable-gpu",`--remote-debugging-port=${CDP}`,"--window-size=1400,900",
   "--user-data-dir=" + profileDir("boot"),
   `http://127.0.0.1:${PORT}/json-browser.html?file=no-such-file.json`],{stdio:"ignore"});
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
  const settle = async () => { for(let i=0;i<60;i++){ await sleep(200);
    if(await ev(`typeof state!=='undefined' && (document.querySelectorAll('#cards .card').length ||
                 document.querySelector('#emptyState').style.display==='block')`)) return; } };
  await settle();

  console.log("\n== a ?file= that never arrives ==");
  ok(await ev(`document.querySelector('#emptyState').style.display`)==="block", "the start page is shown");
  const err = await ev(`document.querySelector('#emptyErr').textContent`);
  ok(!!err, "with a reason, not a blank page that looks like no link was given");
  ok(err.includes("no-such-file.json"), `naming the file: ${JSON.stringify(err)}`);
  ok(/404/.test(err), "and what the server said");
  ok(await ev(`getComputedStyle(document.querySelector('#emptyErr')).display`)!=="none",
     "the message is actually visible");
  ok(await ev(`document.querySelectorAll('#cards .card').length`)===0, "and no cards are rendered");

  console.log("\n== a file that does arrive ==");
  await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/json-browser.html?file=many-test.json`});
  await settle();
  ok(await ev(`document.querySelectorAll('#cards .card').length`)>0, "the records render");
  ok(await ev(`document.querySelector('#emptyState').style.display`)!=="block",
     "with no start page laid over them");
  ok(await ev(`!document.querySelector('#emptyErr').textContent`), "and no stale error text");

  console.log("\n== 'all' past the 1000-row render cap ==");
  await ev(`document.querySelector('.ffield[data-field="code"]').open=true`);
  await sleep(600);
  ok(await ev(`state.values.code.size`)===1100, "the field really has 1100 distinct values");
  const drawn = await ev(`document.querySelectorAll('.ffield[data-field="code"] .vrow').length`);
  ok(drawn===1000, `the panel draws only the first 1000 of them (${drawn})`);
  ok((await ev(`document.querySelector('.ffield[data-field="code"] .fbody').textContent`)).includes("100 more"),
     "and says how many it is holding back");
  await ev(`document.querySelector('.ffield[data-field="code"] .act-all').click()`);
  await sleep(800);
  ok(await ev(`state.filters.code.vals.size`)===1100,
     "'all' selects every value the panel offers, not merely the rows it drew");
  ok(await ev(`+document.querySelector('#resCount').textContent.replace(/,/g,'')`)===1100,
     "so every record still matches — selecting 'all' cannot lose records");
  await ev(`document.querySelector('.ffield[data-field="code"] .act-none').click()`);
  await sleep(800);
  ok(await ev(`state.filters.code.vals.size`)===0, "and 'none' clears every one of them");

  console.log("\n== 'all' still respects the type-ahead ==");
  await ev(`(()=>{const s=document.querySelector('.ffield[data-field="code"] .fsearch');
             s.value='c02'; s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(500);
  await ev(`document.querySelector('.ffield[data-field="code"] .act-all').click()`);
  await sleep(600);
  ok(await ev(`state.filters.code.vals.size`)===100,
     "with c02 typed it takes the 100 matching values and no others");
  ok(await ev(`[...state.filters.code.vals].every(v=>v.includes('c02'))`), "all of them matching");
  ok(errors.length===0, "no exceptions: "+JSON.stringify(errors.slice(0,2)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  ws.close(); chrome.kill(); process.exit(fail?1:0);
})().catch(e=>{console.error(e);chrome.kill();process.exit(1);});
