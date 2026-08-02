/* The ordering rule as it actually reaches the screen. */
const { spawn } = require("child_process");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2], CDP = 9348;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(chromeBin(),
  ["--headless","--disable-gpu",`--remote-debugging-port=${CDP}`,"--window-size=1400,900",
   "--user-data-dir=" + profileDir("numfacet"),
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

  const openField = async k => { await ev(`document.querySelector('.ffield[data-field="${k}"]').open=true`); await sleep(400); };
  const rows = async k => JSON.parse(await ev(
    `JSON.stringify([...document.querySelectorAll('.ffield[data-field="${k}"] .vrow')]
       .map(r=>[r.querySelector('.vtxt').textContent, +r.querySelector('.vc').textContent]))`));

  console.log("\n== a numeric column ==");
  await openField("repec_score");
  const sc = await rows("repec_score");
  ok(sc.length>2, `the panel renders values (${sc.length})`);
  ok(sc.every(([v])=>/^-?[\d.]+$/.test(v)), "all of them numeric");
  ok(sc.every(([v],i)=>i===0||parseFloat(sc[i-1][0])<=parseFloat(v)),
     `ascending by value: ${JSON.stringify(sc.slice(0,4).map(r=>r[0]))}`);
  ok(!sc.every(([,c],i)=>i===0||sc[i-1][1]>=c), "and NOT by count, which is the change");

  console.log("\n== a text column is untouched ==");
  await openField("country");
  const ct = await rows("country");
  ok(ct.every(([,c],i)=>i===0||ct[i-1][1]>=c),
     `still commonest first: ${JSON.stringify(ct.slice(0,3))}`);

  console.log("\n== ordering survives filtering ==");
  await ev(`document.querySelector('.ffield[data-field="country"] input[type=checkbox]').click()`);
  await sleep(500);
  const sc2 = await rows("repec_score");
  ok(sc2.length>0 && sc2.every(([v],i)=>i===0||parseFloat(sc2[i-1][0])<=parseFloat(v)),
     "the numeric column stays ascending under a live filter");
  ok(errors.length===0, "no exceptions: "+JSON.stringify(errors.slice(0,2)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  ws.close(); chrome.kill(); process.exit(fail?1:0);
})().catch(e=>{console.error(e);chrome.kill();process.exit(1);});
