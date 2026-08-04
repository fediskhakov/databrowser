/* Selecting records and copying them. Two things are worth driving the real page
   for: where the checkbox lands (it is positioned, not laid out, so only a real
   render can say whether it sits inside its card), and whether the selection
   survives filtering and paging — which it does by holding record references, a
   claim no unit test can check. The two builders are called directly rather than
   through the clipboard, so the assertions are on the strings themselves; the
   clipboard round trip is then checked once, via the button's own success flash. */
const { spawn } = require("child_process");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2], CDP = 9351;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(chromeBin(),
  ["--headless","--disable-gpu",`--remote-debugging-port=${CDP}`,"--window-size=1400,900",
   "--user-data-dir=" + profileDir("select"),
   `http://127.0.0.1:${PORT}/json-browser.html?file=copy-test.json`],{stdio:"ignore"});
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
  /* userGesture: the clipboard — both the async API and execCommand — refuses to
     run without transient user activation, which a bare Runtime.evaluate lacks */
  const ev=async (e,gesture)=>(await send("Runtime.evaluate",
    {expression:e,returnByValue:true,awaitPromise:true,userGesture:!!gesture})).result.result.value;
  await send("Runtime.enable",{});
  await send("Browser.grantPermissions",{permissions:["clipboardReadWrite","clipboardSanitizedWrite"]});
  for(let i=0;i<60;i++){ if(await ev(`document.querySelectorAll('#cards .card').length`)) break; await sleep(200); }

  const tick = n => ev(`document.querySelectorAll('#cards .selbox')[${n}]
                          .dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  const nsel = () => ev(`state.selected.size`);

  console.log("\n== the box on every card ==");
  ok(await ev(`document.querySelectorAll('#cards .card').length`)===3, "the fixture renders three cards");
  ok(await ev(`document.querySelectorAll('#cards .selbox').length`)===3, "each card carries one select box");
  ok(await ev(`document.querySelectorAll('#cards .selbox label, #cards .selbox + *').length`)===0,
     "with no label of its own");
  /* positioned, so only a real layout can confirm it is in the bottom right corner
     of its own card and not overlapping the content above it */
  ok(await ev(`(() => { const b=document.querySelector('#cards .selbox').getBoundingClientRect(),
       c=document.querySelector('#cards .card').getBoundingClientRect();
       return b.right<=c.right && b.right>c.right-30 && b.bottom<=c.bottom && b.bottom>c.bottom-30; })()`),
     "it sits in the bottom right of its card");
  ok(await ev(`(() => { const b=document.querySelector('#cards .selbox').getBoundingClientRect(),
       last=[...document.querySelectorAll('#cards .card:first-child .cf, #cards .card:first-child .kv')].pop();
       return !last || b.top >= last.getBoundingClientRect().bottom - 1; })()`),
     "below the last row rather than on top of it");

  console.log("\n== the bar appears only when something is selected ==");
  ok(await ev(`document.querySelector('#selbar').hidden`), "it starts hidden");
  ok(await ev(`getComputedStyle(document.querySelector('#selbar')).display`)==="none",
     "and hidden means invisible, not merely marked");
  const searchBefore = await ev(`document.querySelector('#globalSearch').getBoundingClientRect().width`);
  await tick(0); await sleep(120);
  ok(await nsel()===1, "ticking a box selects that record");
  ok(!(await ev(`document.querySelector('#selbar').hidden`)), "the bar appears");
  ok(await ev(`document.querySelector('#selCount').textContent`)==="1 selected", "with the count");
  ok(await ev(`document.querySelector('#cards .card').classList.contains('sel')`), "the card is marked");
  const searchAfter = await ev(`document.querySelector('#globalSearch').getBoundingClientRect().width`);
  ok(searchAfter < searchBefore - 30, "and the header content shifts left to make room");
  ok(await ev(`(() => { const s=document.querySelector('#selbar').getBoundingClientRect(),
       h=document.querySelector('header.top').getBoundingClientRect(),
       p=document.querySelector('.pager').getBoundingClientRect();
       return s.right<=h.right && s.left>=p.right-1 && s.top>=h.top-1 && s.bottom<=h.bottom+1; })()`),
     "the bar is on the top line, at the right of everything else");

  console.log("\n== the two buttons ==");
  ok(await ev(`document.querySelectorAll('#selbar .copybtn').length`)===2, "there are two of them");
  ok(await ev(`getComputedStyle(document.querySelector('#copyShort')).backgroundColor`)==="rgb(37, 99, 235)",
     "both are the accent blue");
  ok(await ev(`getComputedStyle(document.querySelector('#copyFull')).backgroundColor`)==="rgb(37, 99, 235)", "  (the second one too)");
  ok(await ev(`document.querySelector('#copyShort svg text').textContent`)==="S", "the first carries an S");
  ok(await ev(`document.querySelector('#copyFull svg text').textContent`)==="F", "the second an F");
  ok(await ev(`document.querySelectorAll('#copyShort svg rect').length`)===2 &&
     await ev(`document.querySelectorAll('#copyFull svg rect').length`)===2,
     "each on a two-sheet copy glyph");
  ok(await ev(`(document.querySelector('#copyShort').title||'').includes('Short copy')`),
     "the short one says so in its tooltip");
  ok(await ev(`(document.querySelector('#copyFull').title||'').includes('email')`),
     "and the full one says what it is for");
  /* the letter belongs to the glyph; what must not be there is a caption beside it */
  ok(await ev(`[...document.querySelector('#copyShort').childNodes]
                 .every(n=>n.nodeType===1?n.tagName.toLowerCase()==='svg':!n.textContent.trim())`),
     "neither carries a text label — the glyph is the whole button");

  console.log("\n== the selection outlives filtering, sorting and paging ==");
  await ev(`state.search='turing'; document.querySelector('#globalSearch').value='turing'; apply()`);
  await sleep(200);
  ok(await ev(`document.querySelectorAll('#cards .card').length`)===1, "a search hides the selected record");
  ok(await nsel()===1, "which does not deselect it");
  ok(!(await ev(`document.querySelector('#selbar').hidden`)), "the bar stays up");
  await ev(`state.search=''; document.querySelector('#globalSearch').value=''; apply()`);
  await sleep(200);
  ok(await ev(`document.querySelectorAll('#cards .selbox')[0].checked`), "and it comes back still ticked");
  ok(await ev(`document.querySelector('#cards .card').classList.contains('sel')`), "still marked");
  /* reversing the order must not move the tick to whatever record is now first */
  await ev(`state.sorts=[{k:'name',desc:true}]; state.sortSig=null; apply()`);
  await sleep(200);
  ok(await ev(`[...document.querySelectorAll('#cards .selbox')].findIndex(b=>b.checked)`)===2,
     "sorting moves the tick with its record");
  await ev(`state.sorts=[]; state.sortSig=null; apply()`); await sleep(200);

  console.log("\n== the short copy ==");
  await ev(`document.querySelector('#subField').value='role';
            document.querySelector('#subField').dispatchEvent(new Event('change',{bubbles:true}))`);
  await sleep(200);
  await tick(2); await sleep(120);            // Ada and Alan, ticked out of order
  ok(await nsel()===2, "two records selected");
  ok(await ev(`document.querySelector('#selCount').textContent`)==="2 selected", "the count follows");
  const txt = await ev(`selectionText()`);
  const recs = txt.split("\n\n");
  ok(recs.length===2, "one block per record, blank line between");
  ok(recs[0].split("\n")[0]==="Ada Lovelace — Analyst", "title and subtitle head the block");
  ok(recs[1].split("\n")[0]==="Alan Turing — Logician", "and they come in the order shown, not the order ticked");
  ok(recs[0].includes("\n  orcid: 0000-0002-1825-0097"), "fields are indented key: value");
  ok(recs[0].includes("\n  homepage: https://example.org/people/ada-lovelace/profile/page"),
     "a URL shown as a label arrives whole — text cannot hold a link");
  ok(recs[0].includes("\n  photo: https://example.org/img/ada.jpg"),
     "the thumbnail is named by its address");
  ok(!/\n  role:/.test(recs[0]), "the subtitle is not repeated as a row");
  ok(!/empty/.test(txt), "an empty field is not mentioned");
  ok(/\n  bio: She worked on the Analytical Engine .* by a machine, together with notes running/.test(recs[0]),
     "long text is printed in full, its newline collapsed as the page collapses it");
  ok(recs[0].includes("\n  tags (2): math; computing"), "an array of scalars stays on one line");
  ok(recs[0].includes("\n  works (2):\n    Note G — Memoirs, 1843\n    Sketch of the Analytical Engine"),
     "an array of objects gets a line each");
  ok(recs[0].includes("\n  active: true"), "booleans print as themselves");

  console.log("\n== choosing what the short copy prints ==");
  await ev(`document.querySelector('#metaBox').open=true`); await sleep(150);
  ok(await ev(`document.querySelectorAll('#metaBody [data-shorttog]').length`)>0,
     "the metadata panel has a row of its own for it");
  ok(await ev(`document.querySelector('#metaBody .ico text').textContent`)==="S",
     "marked with a small copy of the S glyph");
  ok(await ev(`getComputedStyle(document.querySelector('#metaBody .ico')).stroke`)==="rgb(37, 99, 235)",
     "in the accent colour, not the button's white");
  ok(await ev(`[...document.querySelectorAll('#metaBody [data-shorttog]')].every(b=>b.checked)`),
     "every field starts in the short copy");
  ok(await ev(`!!document.querySelector('#metaBody [data-shorttog="name"]')`) &&
     await ev(`!!document.querySelector('#metaBody [data-shorttog="role"]')`),
     "the title and subtitle among them — unlike the display row, a short copy may drop the heading");
  ok(await ev(`!document.querySelector('#metaBody .shortrow .ftog.fixed')`),
     "so nothing in this row is fixed on");
  ok(await ev(`[...document.querySelectorAll('#metaBody [data-shorttog]')].map(b=>b.dataset.shorttog)
                 .filter(k=>['tags','works'].includes(k)).length`)===2,
     "nested fields are offered too");
  const before = await ev(`selectionText()`);
  await ev(`(()=>{const b=document.querySelector('#metaBody [data-shorttog="homepage"]');
             b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await ev(`(()=>{const b=document.querySelector('#metaBody [data-shorttog="works"]');
             b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(200);
  const after = await ev(`selectionText()`);
  ok(before.includes("homepage:") && !after.includes("homepage:"), "unticking a field drops it from the short copy");
  ok(before.includes("works (2):") && !after.includes("works (2):"), "nested fields too");
  ok(after.includes("orcid: 0000-0002-1825-0097"), "the rest is untouched");
  ok(after.split("\n")[0]==="Ada Lovelace — Analyst", "and the heading always stays");
  ok(await ev(`document.querySelector('#shortNote').textContent.includes('2 left out')`),
     "the row counts what it is leaving out");
  /* a field switched off above is in no copy at all, and the row says so at once —
     it is not re-rendered, so the marking has to be pushed across */
  await ev(`(()=>{const b=document.querySelector('#metaBody [data-fieldtog="score"]');
             b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(250);
  ok(await ev(`document.querySelector('#metaBody [data-shorttog="score"]').closest('.ftog').classList.contains('gone')`),
     "switching a field off greys its chip in the short-copy row too");
  ok(!(await ev(`selectionText()`)).includes("score:"), "and it leaves both copies");
  await ev(`(()=>{const b=document.querySelector('#metaBody [data-fieldtog="score"]');
             b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(250);
  ok(!(await ev(`document.querySelector('#metaBody [data-shorttog="score"]').closest('.ftog').classList.contains('gone')`)),
     "switching it back on un-greys it");
  const fullHTML = await ev(`selectionHTML()`);
  ok(fullHTML.includes(">open homepage<") && fullHTML.includes("Note G"),
     "the FULL copy is unaffected — it prints every field shown");
  ok(await ev(`[...document.querySelectorAll('#cards .card:first-child .kv .k')].some(e=>e.textContent==='homepage')`),
     "and so is the page: this row changes nothing on screen");

  console.log("\n== it is a shareable setting: h2 ==");
  ok(await ev(`/[?&]h2=/.test(location.search)`), "the choice is written into the URL");
  ok(await ev(`decodeURIComponent(location.search).includes('h2=homepage,works')`),
     "as one packed parameter\n         got "+await ev(`location.search`));
  ok(!(await ev(`/[?&]h=/.test(location.search)`)), "and not confused with h, which is still empty");
  /* a reload is the only honest test of the reader: the whole page rebuilds from the URL */
  const url = await ev(`location.href`);
  await send("Page.navigate",{url});
  for(let i=0;i<60;i++){ await sleep(200);
    if(await ev(`typeof state!=='undefined' && document.querySelectorAll('#cards .card').length`)) break; }
  await ev(`document.querySelector('#metaBox').open=true`); await sleep(150);
  ok(await ev(`[...state.shortOff].sort().join(",")`)==="homepage,works", "and read back on reload");
  ok(await ev(`!document.querySelector('#metaBody [data-shorttog="homepage"]').checked`),
     "the row comes back with those two unticked");
  ok(await ev(`document.querySelector('#metaBody [data-shorttog="orcid"]').checked`), "and the others ticked");
  ok(await ev(`state.selected.size`)===0, "the selection itself did not survive — it is not in the URL");
  /* everything below starts from a clean reloaded page */
  await ev(`document.querySelector('#metaBody [data-stog="all"]').click()`); await sleep(200);
  ok(await ev(`state.shortOff.size`)===0 && !(await ev(`/[?&]h2=/.test(location.search)`)),
     "\"all\" puts every field back, and h2 leaves the URL");
  await ev(`document.querySelector('#metaBody [data-stog="none"]').click()`); await sleep(200);
  ok(await ev(`state.shortOff.size`)===11, "\"none\" takes them all out, the heading included");
  await tick(0); await sleep(150);
  ok(await ev(`selectionText()`)==="", "which leaves the short copy with nothing to say");

  console.log("\n== the heading is a choice like any other ==");
  const stog = (f,on) => ev(`(()=>{const b=document.querySelector('#metaBody [data-shorttog="${f}"]');
                             b.checked=${!!on}; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await stog("name",true); await sleep(150);
  ok(await ev(`selectionText()`)==="Ada Lovelace", "the title alone is the whole block");
  await stog("role",true); await sleep(150);
  ok(await ev(`selectionText()`)==="Ada Lovelace — Analyst", "the subtitle joins it after a dash");
  await stog("name",false); await sleep(150);
  ok(await ev(`selectionText()`)==="Analyst", "dropping the title leaves the subtitle standing alone, undashed");
  await stog("orcid",true); await sleep(150);
  ok(await ev(`selectionText()`)==="Analyst\n  orcid: 0000-0002-1825-0097",
     "and fields indent under whatever heading is left");
  await stog("role",false); await sleep(150);
  ok(await ev(`selectionText()`)==="orcid: 0000-0002-1825-0097",
     "with no heading at all they sit at the margin — nothing to indent under");
  ok((await ev(`decodeURIComponent(location.search)`)).includes("h2=name,role"),
     "and the heading fields ride in h2 like the rest");
  await ev(`document.querySelector('#metaBody [data-stog="all"]').click()`); await sleep(200);
  await ev(`document.querySelector('#selClear').click()`); await sleep(150);
  await tick(0); await tick(2); await sleep(200);

  console.log("\n== the full copy, as HTML ==");
  const html = await ev(`selectionHTML()`);
  ok(!/\sclass=/.test(html), "no class attributes — a mail client would drop them");
  ok(!/<style/i.test(html), "and no style block, for the same reason");
  ok(!/<details|<summary/i.test(html), "nothing collapsible: an email cannot open it");
  ok((html.match(/<div style="border:1px solid/g)||[]).length===2, "one styled card per record");
  ok(/>Ada Lovelace\s*</.test(html) && />Alan Turing\s*</.test(html), "both records are in it");
  ok(!html.includes("Grace Hopper"), "and only those");
  ok(/<img src="https:\/\/example\.org\/img\/ada\.jpg"[^>]*width="72"/.test(html), "the thumbnail comes along");
  ok(html.includes('href="https://orcid.org/0000-0002-1825-0097"'), "an identifier keeps its resolved link");
  ok(html.includes(">0000-0002-1825-0097<"), "showing the identifier, not the URL");
  ok(html.includes('href="https://example.org/people/ada-lovelace/profile/page"') && html.includes(">open homepage<"),
     "a long URL keeps the page's label and the full address");
  ok((html.match(/<td style="width:140px/g)||[]).length>=8, "fields are table rows, the layout mail clients keep");
  ok(html.includes("math</span>"), "array items become chips");
  ok(html.includes("Note G") && html.includes("Memoirs, 1843"), "nested objects are expanded in place");
  ok(!html.includes(">empty<"), "an empty field is left out here too");
  ok(/color:#2563eb/.test(html) && /font:14px/.test(html), "every rule is inline");

  console.log("\n== the buttons reach the clipboard ==");
  /* read it back rather than trust the flash: the flavors a paste target is
     offered are the whole point, and only the real clipboard has them */
  const clip = `(async () => { const out={};
     out.text = await navigator.clipboard.readText();
     const items = await navigator.clipboard.read();
     out.types = items.flatMap(i => i.types).join("|");
     for (const i of items) for (const t of i.types) out[t] = await (await i.getType(t)).text();
     return JSON.stringify(out); })()`;
  /* with the short copy narrowed — otherwise the two texts are identical and the
     flavors below prove nothing */
  await ev(`(()=>{const b=document.querySelector('#metaBody [data-shorttog="homepage"]');
             b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(200);
  await ev(`document.querySelector('#copyShort').click()`,true); await sleep(500);
  ok(await ev(`document.querySelector('#copyShort').classList.contains('ok')`),
     "the short button reports success");
  const cs = JSON.parse(await ev(clip));
  ok(cs.types==="text/plain", "S puts plain text on the clipboard, and only that");
  ok(cs.text===await ev(`selectionText()`) && !cs.text.includes("homepage:"),
     "exactly what the short builder produced, narrowed and all");
  await ev(`document.querySelector('#copyFull').click()`,true); await sleep(500);
  ok(await ev(`document.querySelector('#copyFull').classList.contains('ok')`),
     "and so does the full one");
  const cf = JSON.parse(await ev(clip));
  ok(cf.types==="text/plain|text/html", "F puts both flavors on, so the target can choose");
  ok(cf["text/html"].startsWith("<div style="), "the HTML one is the styled cards");
  /* the bug this exists for: F's plain flavor was the SHORT text, so a paste into a
     plain editor arrived narrowed — or, with everything unticked, empty */
  ok(cf.text===await ev(`selectionText(true)`) && cf.text.includes("homepage:"),
     "and its plain flavor is the FULL text, not the short one");
  /* the limit case that made it visible: nothing ticked at all */
  await ev(`document.querySelector('#metaBody [data-stog="none"]').click()`); await sleep(250);
  await ev(`document.querySelector('#copyFull').click()`,true); await sleep(500);
  ok((JSON.parse(await ev(clip))).text.includes("Ada Lovelace"),
     "with the short copy emptied entirely, the full copy still pastes as text");
  await ev(`document.querySelector('#metaBody [data-stog="all"]').click()`); await sleep(250);
  await sleep(700);
  ok(!(await ev(`document.querySelector('#copyShort').classList.contains('ok')`)),
     "the confirmation fades on its own");

  console.log("\n== full-width view ==");
  await ev(`document.querySelector('#viewMode').value='full';
            document.querySelector('#viewMode').dispatchEvent(new Event('change',{bubbles:true}))`);
  await sleep(250);
  ok(await ev(`document.querySelector('#cards').classList.contains('full')`), "the view switches");
  ok(await ev(`document.querySelectorAll('#cards .selbox').length`)===3, "the boxes are still there");
  ok(await ev(`[...document.querySelectorAll('#cards .selbox')].filter(b=>b.checked).length`)===2,
     "still ticked");
  ok(await ev(`(() => { const b=document.querySelector('#cards .selbox').getBoundingClientRect(),
       c=document.querySelector('#cards .card').getBoundingClientRect();
       return b.right<=c.right && b.right>c.right-30 && b.bottom<=c.bottom && b.bottom>c.bottom-30; })()`),
     "and still in the bottom right corner");
  await ev(`document.querySelector('#viewMode').value='cards';
            document.querySelector('#viewMode').dispatchEvent(new Event('change',{bubbles:true}))`);
  await sleep(250);

  console.log("\n== double-click takes the whole page ==");
  await ev(`document.querySelector('#selClear').click()`); await sleep(150);
  /* the real sequence a browser sends: two clicks that cancel out, then dblclick */
  const dbl = n => ev(`(()=>{const b=document.querySelectorAll('#cards .selbox')[${n}];
     b.dispatchEvent(new MouseEvent('click',{bubbles:true}));
     b.dispatchEvent(new MouseEvent('click',{bubbles:true}));
     b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await dbl(1); await sleep(200);
  ok(await nsel()===3, "from nothing selected, it ticks every card");
  ok(await ev(`[...document.querySelectorAll('#cards .selbox')].every(b=>b.checked)`), "boxes and all");
  ok(await ev(`document.querySelectorAll('#cards .card.sel').length`)===3, "each card marked");
  ok(await ev(`document.querySelector('#selCount').textContent`)==="3 selected", "and counted");
  await dbl(1); await sleep(200);
  ok(await nsel()===0, "doing it again clears them");
  ok(await ev(`document.querySelector('#selbar').hidden`), "and the bar goes away");
  await tick(0); await sleep(150);
  await dbl(2); await sleep(200);
  ok(await nsel()===3, "from a partial selection it fills the page rather than clearing it");
  /* "the page", not the dataset: what is on screen is what it takes */
  await ev(`document.querySelector('#selClear').click()`); await sleep(150);
  await ev(`state.search='turing'; document.querySelector('#globalSearch').value='turing'; apply()`);
  await sleep(250);
  await dbl(0); await sleep(200);
  ok(await ev(`document.querySelectorAll('#cards .card').length`)===1 && await nsel()===1,
     "under a filter it takes only the records the filter left");
  await ev(`state.search=''; document.querySelector('#globalSearch').value=''; apply()`);
  await sleep(250);
  ok(await ev(`[...document.querySelectorAll('#cards .selbox')].filter(b=>b.checked).length`)===1,
     "the other records were never touched");
  ok((await ev(`document.querySelector('#cards .selbox').title`)).includes("double-click"),
     "the box's tooltip says so");

  console.log("\n== clearing ==");
  await ev(`document.querySelector('#selClear').click()`); await sleep(200);
  ok(await nsel()===0, "the ✕ empties the selection");
  ok(await ev(`document.querySelector('#selbar').hidden`), "the bar goes away");
  ok(await ev(`[...document.querySelectorAll('#cards .selbox')].every(b=>!b.checked)`), "every box clears");
  ok(await ev(`!document.querySelectorAll('#cards .card.sel').length`), "and no card stays marked");
  ok(await ev(`selectionText()`)==="" && await ev(`selectionHTML().includes('border:1px solid')`)===false,
     "an empty selection copies nothing");

  console.log("\n== the selection belongs to the loaded array ==");
  await tick(0); await sleep(150);
  ok(await nsel()===1, "select one again");
  await ev(`setRecordSource('people',true)`); await sleep(250);
  ok(await nsel()===0, "changing the record array drops it — its records are gone");
  ok(await ev(`document.querySelector('#selbar').hidden`), "and the bar with it");

  console.log("\n== the URL is not touched ==");
  ok(await ev(`!/[?&](sel|copy)/.test(location.search)`), "no selection parameter is written");

  ok(errors.length===0, "no exceptions: "+JSON.stringify(errors.slice(0,2)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  ws.close(); chrome.kill(); process.exit(fail?1:0);
})().catch(e=>{console.error(e);chrome.kill();process.exit(1);});
