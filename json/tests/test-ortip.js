/* The OR help must be reachable by hover in BOTH states — especially the disabled
   one, which is exactly when a newcomer would go looking for it. */
const { spawn } = require("child_process");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2], CDP = 9347;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(chromeBin(),
  ["--headless","--disable-gpu",`--remote-debugging-port=${CDP}`,"--window-size=1400,900",
   "--user-data-dir=" + profileDir("ortip"),
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
  const ev=async e=>(await send("Runtime.evaluate",{expression:e,returnByValue:true})).result.result.value;
  await send("Runtime.enable",{});
  for(let i=0;i<60;i++){ if(await ev(`document.querySelectorAll('#cards .card').length`)) break; await sleep(200); }

  /* what a browser actually shows as a tooltip: the nearest ancestor with a title */
  const hitTitle = `(() => {
     const b=document.querySelector('#orFilter'), r=b.getBoundingClientRect();
     let n=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
     while(n && !n.getAttribute('title')) n=n.parentElement;
     return n ? n.getAttribute('title') : null; })()`;

  console.log("\n== disabled (nothing filtered yet) ==");
  ok(await ev(`document.querySelector('#orFilter').disabled`), "the button starts disabled");
  const t1 = await ev(hitTitle);
  ok(!!t1 && t1.startsWith("OR —"), "hovering it still resolves to the help text");
  ok(t1 && t1.includes("press OR") && t1.includes("×"),
     "which explains the workflow and both counts");

  console.log("\n== enabled (a filter is set) ==");
  await ev(`document.querySelector('.ffield[data-field="country"]').open=true`);
  await sleep(300);
  await ev(`document.querySelector('.ffield[data-field="country"] input[type=checkbox]').click()`);
  await sleep(400);
  ok(await ev(`!document.querySelector('#orFilter').disabled`), "the button enables");
  ok(await ev(hitTitle) === t1, "and hover resolves to the same help text");

  console.log("\n== the wrapper did not disturb the row ==");
  const h = await ev(`JSON.stringify([...document.querySelectorAll('.side .actions .mini')]
                        .map(b=>Math.round(b.getBoundingClientRect().height)))`);
  const hs = JSON.parse(h);
  ok(new Set(hs).size === 1, `all three buttons are the same height (${h})`);
  ok(await ev(`(() => { const a=document.querySelector('.side .actions').getBoundingClientRect(),
       b=document.querySelector('#orFilter').getBoundingClientRect();
       return b.bottom<=a.bottom+0.5 && b.top>=a.top-0.5; })()`), "and the OR button sits inside the row");

  console.log("\n== the button still works ==");
  await ev(`document.querySelector('#orFilter').click()`);
  await sleep(400);
  ok(await ev(`document.querySelectorAll('#clauses .clause').length`)===1, "clicking it still saves a set");
  ok(await ev(`document.querySelector('#orFilter').disabled`), "and it disables again afterwards");
  ok(errors.length===0, "no exceptions: "+JSON.stringify(errors.slice(0,2)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  ws.close(); chrome.kill(); process.exit(fail?1:0);
})().catch(e=>{console.error(e);chrome.kill();process.exit(1);});
