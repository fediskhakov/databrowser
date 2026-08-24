/* Notes on records: the green button's two jobs, the N button beside it, the boxes,
   what reaches the copies, the JSON that gets written, a file that arrives with notes
   of its own, and the guard on the ways a note can be lost. The download is captured
   with Page.setDownloadBehavior so the file itself can be read back — the button's
   own success flag would prove nothing about its contents. */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { chromeBin, profileDir } = require("./lib.js");
const PORT = process.argv[2], CDP = 9355;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), "json-browser-dl-"));
const chrome = spawn(chromeBin(),
  ["--headless","--disable-gpu",`--remote-debugging-port=${CDP}`,"--window-size=1400,900",
   "--user-data-dir=" + profileDir("notes"),
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
  const ev=async (e,g)=>(await send("Runtime.evaluate",
    {expression:e,returnByValue:true,awaitPromise:true,userGesture:!!g})).result.result.value;
  await send("Runtime.enable",{});
  await send("Page.setDownloadBehavior",{behavior:"allow",downloadPath:dlDir});
  for(let i=0;i<60;i++){ if(await ev(`document.querySelectorAll('#cards .card').length`)) break; await sleep(200); }

  const type = (n,text) => ev(`(()=>{const t=document.querySelectorAll('#cards .note')[${n}];
     t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  /* :hover cannot be faked from script — the pointer has to actually be there */
  const point = async sel => {
    const p=JSON.parse(await ev(sel
      ? `(()=>{const b=document.querySelector('${sel}').getBoundingClientRect();
          return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)});})()`
      : `JSON.stringify({x:5,y:400})`));
    await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:p.x,y:p.y,buttons:0});
    await sleep(150);
  };
  const noteBg = () => ev(`getComputedStyle(document.querySelector('#noteBtn')).backgroundColor`);
  const icon = () => ev(`(()=>{const b=document.querySelector('#noteBtn');
     return getComputedStyle(b.querySelector('.ico-save')).display!=='none' ? 'save' : 'note';})()`);

  console.log("\n== the button starts as a toggle ==");
  ok(await ev(`!!document.querySelector('header.top #noteBtn')`), "it is on the top line");
  ok(await ev(`(()=>{const b=document.querySelector('#noteBtn').getBoundingClientRect(),
       h=document.querySelector('header.top').getBoundingClientRect();
       return h.right-b.right < 20;})()`), "at the right-hand end of it");
  ok(await ev(`document.querySelector('header.top').lastElementChild.id`)==="noteBtn",
     "last, so the selection bar appearing does not move it");
  /* a true toggle: outlined green while the boxes are hidden, filled while they are up */
  ok(await ev(`getComputedStyle(document.querySelector('#noteBtn')).borderTopColor`)==="rgb(21, 128, 61)",
     "green from the start — it is the notes' button, and green is the notes' colour");
  ok(await ev(`getComputedStyle(document.querySelector('#noteBtn')).backgroundColor`)==="rgb(255, 255, 255)",
     "but outlined rather than filled, the boxes being hidden");
  ok(await ev(`getComputedStyle(document.querySelector('#noteBtn')).color`)==="rgb(21, 128, 61)",
     "with the glyph in the same green");
  await point("#noteBtn");
  ok(await noteBg()==="rgb(243, 251, 246)", "hovering washes it, rather than filling it");
  await point(null);
  ok(await noteBg()==="rgb(255, 255, 255)", "and it lets go again");
  ok(await icon()==="note", "showing the note icon, not the download one");
  ok(await ev(`document.querySelectorAll('#cards .note').length`)===0, "with no note boxes yet");
  ok(await ev(`document.querySelector('#noteBtn').getAttribute('aria-pressed')`)==="false", "and not pressed");

  console.log("\n== toggling the boxes on and off ==");
  ok(await ev(`document.querySelector('#noteCopy').hidden`),
     "the copy button is down while the boxes are");
  await ev(`document.querySelector('#noteBtn').click()`); await sleep(300);
  ok(await ev(`document.querySelectorAll('#cards .note').length`)===3, "every card gets one");
  ok(await ev(`!document.querySelector('#noteCopy').hidden`), "and comes up with them");
  ok(await ev(`document.querySelector('#noteCopy').disabled`),
     "dulled, there being nothing written to copy yet");
  ok(await ev(`document.querySelector('#noteBtn').getAttribute('aria-pressed')`)==="true", "the button reads as pressed");
  ok(await ev(`!document.querySelector('#cards .note').labels.length`),
     "the box has no caption of its own");
  ok(await ev(`getComputedStyle(document.querySelector('#cards .note')).borderTopColor`)==="rgb(21, 128, 61)",
     "bordered in the notes' green");
  /* the toggle is outline versus fill, not one green versus another */
  ok(await ev(`getComputedStyle(document.querySelector('#noteBtn')).backgroundColor`)==="rgb(21, 128, 61)",
     "and the button fills with the same green now the boxes are up");
  ok(await ev(`getComputedStyle(document.querySelector('#noteBtn')).color`)==="rgb(255, 255, 255)",
     "its glyph turning white against it");
  await point("#noteBtn");
  ok(await noteBg()==="rgb(22, 101, 52)", "the darker green being the hover here");
  await point(null);
  ok(await noteBg()==="rgb(21, 128, 61)", "and only the hover");
  /* a full-width line under everything else, with the select box still in its corner */
  ok(await ev(`(()=>{const t=document.querySelector('#cards .note').getBoundingClientRect(),
       c=document.querySelector('#cards .card').getBoundingClientRect();
       return t.width > c.width-40;})()`), "running the full width of the card");
  ok(await ev(`(()=>{const t=document.querySelector('#cards .note').getBoundingClientRect(),
       b=document.querySelector('#cards .selbox').getBoundingClientRect();
       return t.bottom <= b.top+1;})()`), "above the select box, not beside it");
  ok(await ev(`(()=>{const b=document.querySelector('#cards .selbox').getBoundingClientRect(),
       c=document.querySelector('#cards .card').getBoundingClientRect();
       return b.right<=c.right && b.right>c.right-30 && b.bottom<=c.bottom && b.bottom>c.bottom-30;})()`),
     "which keeps the bottom right corner it has always had");
  const oneLine = await ev(`document.querySelector('#cards .note').getBoundingClientRect().height`);
  ok(oneLine<34, `one line high to start with (${Math.round(oneLine)}px)`);
  await ev(`document.querySelector('#noteBtn').click()`); await sleep(300);
  ok(await ev(`document.querySelectorAll('#cards .note').length`)===0, "clicking again hides them");
  ok(await ev(`document.querySelector('#noteCopy').hidden`), "and takes the copy button down with them");
  await ev(`document.querySelector('#noteBtn').click()`); await sleep(300);

  console.log("\n== writing one ==");
  await type(0,"first thought"); await sleep(250);
  ok(await ev(`state.notes.size`)===1, "the note is kept");
  ok(await icon()==="save", "and the button becomes the way to save it");
  ok((await ev(`document.querySelector('#noteBtn').title`)).includes("Download"),
     "saying so in its tooltip");
  /* the download job changes the icon, not the colour: the darker green stays a
     hover, in this state exactly as in the other */
  ok(await noteBg()==="rgb(21, 128, 61)",
     "still the filled green — the icon alone says what the click now does");
  await point("#noteBtn");
  ok(await noteBg()==="rgb(22, 101, 52)", "and the darker green is the hover here too");
  await point(null);
  ok(await noteBg()==="rgb(21, 128, 61)",
     "never a state of its own, in download mode any more than in the other");
  await type(0,"first thought\nsecond line\nthird line"); await sleep(250);
  const grown = await ev(`document.querySelectorAll('#cards .note')[0].getBoundingClientRect().height`);
  ok(grown>oneLine+20, `it grows with the lines (${Math.round(oneLine)} → ${Math.round(grown)}px)`);
  ok(await ev(`!document.querySelector('#noteCopy').disabled`),
     "and the copy button wakes up, there being something to copy now");
  await type(1,"a note on Grace"); await sleep(250);
  ok(await ev(`state.notes.size`)===2, "a second note on another card");

  console.log("\n== the copies carry them ==");
  await ev(`document.querySelectorAll('#cards .selbox')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await sleep(250);
  const s = await ev(`selectionText()`);
  /* "  notes: " is nine characters, so the lines under it start at column nine */
  const hang = "\n  notes: first thought\n" + " ".repeat(9) + "second line\n" + " ".repeat(9) + "third line";
  ok(s.endsWith(hang),
     "the short copy ends with the note, its line breaks kept and hanging under the value"+
     "\n         got "+JSON.stringify(s.slice(-90)));
  ok((await ev(`selectionText(true)`)).includes("notes: first thought"), "so does the full text");
  ok((await ev(`selectionHTML()`)).includes("white-space:pre-wrap"),
     "and the HTML copy keeps the breaks with pre-wrap");
  ok((await ev(`selectionHTML()`)).includes("second line"), "with the whole note in it");

  console.log("\n== and can be told not to ==");
  await ev(`document.querySelector('#metaBox').open=true`); await sleep(200);
  ok(await ev(`!!document.querySelector('#metaBody [data-shorttog="notes"]')`),
     "the short-copy row offers the notes as a field of their own");
  await ev(`(()=>{const b=document.querySelector('#metaBody [data-shorttog="notes"]');
             b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(250);
  ok(!(await ev(`selectionText()`)).includes("notes:"), "unticking keeps them out of the short copy");
  ok((await ev(`selectionText(true)`)).includes("notes: first thought"), "the full copy still has them");
  await ev(`(()=>{const b=document.querySelector('#metaBody [data-shorttog="notes"]');
             b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(250);
  ok(!/[?&]h2=/.test(await ev(`location.search`)) || !(await ev(`decodeURIComponent(location.search)`)).includes("notes"),
     "and none of this reaches the URL");

  console.log("\n== N copies them as text, and changes nothing ==");
  const nt = await ev(`notesText()`);
  ok(nt.split("\n\n").length===2, "one block per noted record, and only those");
  ok(nt.startsWith("Ada Lovelace"), "in the order the page is sorted");
  ok(nt.includes("\n  orcid: 0000-0002-1825-0097"), "in the short-copy format");
  ok(nt.includes("\n  notes: first thought\n"+" ".repeat(9)+"second line"),
     "with the note as its own field, laid out as the copies lay it out");
  ok(nt.includes("a note on Grace"), "and every note present");
  await ev(`document.querySelector('#noteCopy').click()`,true); await sleep(300);
  ok(await ev(`state.notesDirty`)===true,
     "copying leaves them unsaved — it reads them out, it does not keep them");
  ok(await icon()==="save", "so the green button still offers the file");

  console.log("\n== the green button writes the whole file back ==");
  const grab = async name => { const f=path.join(dlDir,name);
    for(let i=0;i<40;i++){ await sleep(200); if(fs.existsSync(f)) return fs.readFileSync(f,"utf8"); }
    return null; };
  await ev(`document.querySelector('#noteBtn').click()`,true);
  const jtext = await grab("copy-test-notes.json");
  ok(jtext!==null, "named after the data, and JSON: copy-test-notes.json");
  const jd = jtext ? JSON.parse(jtext) : {people:[]};
  ok(jd.generated==="2026-08-04" && typeof jd.description==="string",
     "the file comes back whole, wrapper keys and all");
  ok(jd.people.length===3, "with every record of the array");
  ok(jd.people[0].notes==="first thought\nsecond line\nthird line",
     "the note written into its record, line breaks and all");
  ok(jd.people[1].notes==="a note on Grace", "each one into its own");
  ok(!("notes" in jd.people[2]), "and no field at all where nothing was written");
  ok(jd.people[0].name==="Ada Lovelace" && Array.isArray(jd.people[0].works),
     "the record otherwise untouched");
  ok(await icon()==="note", "the button goes back to being a toggle");
  ok(await ev(`state.notes.size`)===2, "while the notes themselves stay on the cards");

  console.log("\n== editing again marks them unsaved ==");
  await type(2,"one more"); await sleep(250);
  ok(await icon()==="save", "the download arrow comes back");
  ok(await ev(`state.notesDirty`)===true, "and the page knows they are unsaved");

  console.log("\n== the card being written on ==");
  await ev(`document.querySelectorAll('#cards .note')[1].focus()`); await sleep(200);
  ok(await ev(`document.querySelectorAll('#cards .card')[1].classList.contains('noting')`),
     "takes a class while the cursor is in its note");
  ok(await ev(`getComputedStyle(document.querySelectorAll('#cards .card')[1]).backgroundColor`)
       ==="rgb(243, 251, 246)", "and a pale green wash");
  ok(await ev(`!document.querySelectorAll('#cards .card')[0].classList.contains('noting')`),
     "one card at a time");
  await ev(`document.querySelectorAll('#cards .note')[0].focus()`); await sleep(200);
  ok(await ev(`document.querySelectorAll('#cards .card')[0].classList.contains('noting')`) &&
     !(await ev(`document.querySelectorAll('#cards .card')[1].classList.contains('noting')`)),
     "the wash follows the cursor");
  await ev(`document.activeElement.blur()`); await sleep(200);
  ok(await ev(`!document.querySelectorAll('#cards .card.noting').length`),
     "and leaves with it");

  console.log("\n== Tab walks the notes and nothing else ==");
  const tab = shift => ev(`(()=>{const e=new KeyboardEvent('keydown',
     {key:'Tab',bubbles:true,cancelable:true,shiftKey:${!!shift}});
     document.dispatchEvent(e); return e.defaultPrevented;})()`);
  const focusIdx = () => ev(`[...document.querySelectorAll('#cards .note')].indexOf(document.activeElement)`);
  await ev(`document.querySelector('#globalSearch').focus()`);
  ok(await tab(false)===true, "Tab is taken over while the boxes are up");
  ok(await focusIdx()===0, "and lands on the first note wherever it started");
  await tab(false); ok(await focusIdx()===1, "then the next");
  await tab(false); ok(await focusIdx()===2, "and the next");
  await tab(false); ok(await focusIdx()===0, "wrapping round at the end");
  await tab(true);  ok(await focusIdx()===2, "shift-Tab goes back, wrapping too");
  ok(await ev(`document.activeElement.tagName`)==="TEXTAREA",
     "so nothing between the cards ever takes focus");
  await ev(`state.notesOn=false; renderCards(); renderNoteBtn()`); await sleep(300);
  ok(await tab(false)===false, "with the boxes hidden, Tab is ordinary again");
  await ev(`state.notesOn=true; renderCards(); renderNoteBtn()`); await sleep(300);

  console.log("\n== the guard on losing them ==");
  await ev(`document.querySelector('#recordArray').value='people';
            document.querySelector('#recordArray').dispatchEvent(new Event('change',{bubbles:true}))`);
  await sleep(400);
  ok(!(await ev(`document.querySelector('#guard').hidden`)), "changing the record array asks first");
  ok((await ev(`document.querySelector('#guardMsg').textContent`)).includes("3 notes have not been saved"),
     "saying how many are at stake");
  ok(await ev(`!!document.querySelector('#guardSave') && !!document.querySelector('#guardDiscard')
               && !!document.querySelector('#guardCancel')`), "offering to save, to discard, or to stay");
  await ev(`document.querySelector('#guardCancel').click()`); await sleep(300);
  ok(await ev(`document.querySelector('#guard').hidden`), "cancelling closes it");
  ok(await ev(`state.notes.size`)===3, "and keeps every note");

  await ev(`document.querySelector('#recordArray').dispatchEvent(new Event('change',{bubbles:true}))`);
  await sleep(400);
  await ev(`document.querySelector('#guardDiscard').click()`); await sleep(500);
  ok(await ev(`state.notes.size`)===0, "discarding lets it through and drops them");
  ok(await ev(`state.notesDirty`)===false, "with nothing left unsaved");
  ok(await icon()==="note", "and the button back to a toggle");
  console.log("\n== a file that arrives with notes of its own ==");
  await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/json-browser.html?file=notes-test.json`});
  for(let i=0;i<60;i++){ await sleep(200);
    if((await ev(`(()=>{try{return document.querySelectorAll('#cards .card').length}catch(e){return 0}})()`))===4) break; }
  ok(await ev(`state.notesAdopted`)===true, "its notes column is adopted rather than duplicated");
  ok(await ev(`state.notesOn`)===true, "and the page opens straight into writing them");
  ok(await ev(`document.querySelectorAll('#cards .note').length`)===4,
     "boxes on every card without a click");
  ok(await ev(`state.notes.size`)===2, "filled from the file, the empty one counting for nothing");
  ok(await ev(`document.querySelectorAll('#cards .note')[0].value`)==="kept from the file",
     "each box holding its record's own note");
  ok(await ev(`document.querySelectorAll('#cards .note')[3].value`)==="two lines\nof it",
     "line breaks included");
  ok(await ev(`state.notesDirty`)===false && await icon()==="note",
     "nothing unsaved yet: reading a file is not editing it");
  ok(await ev(`!document.querySelector('#noteCopy').hidden`) &&
     await ev(`!document.querySelector('#noteCopy').disabled`),
     "both actions on offer from the start");
  ok(await ev(`NOTE_LABEL()`)==="notes", "one notes field, so one name for it");
  ok(!(await ev(`document.querySelectorAll('#cards .card')[0].innerText`)).includes("kept from the file"),
     "the column is not drawn as a row as well — the box is that field");
  ok(await ev(`state.scalarFields.includes("notes")`),
     "though it stays a field of the data, filterable like any other");
  await ev(`document.querySelector('#metaBox').open=true`); await sleep(200);
  ok(await ev(`document.querySelectorAll('#metaBody [data-shorttog="notes"]').length`)===1,
     "and the short-copy row offers it once, not twice");

  console.log("\n== editing what it brought, and writing it back ==");
  await type(0,"edited on the page"); await type(1,"added where there was none");
  await type(3,""); await sleep(300);
  ok(await ev(`state.notesDirty`)===true, "an edit marks the file unsaved");
  ok(await ev(`notesPending()`)===true, "clearing one counts as a change too, on an adopted column");
  await ev(`document.querySelector('#noteBtn').click()`,true);
  const ntext = await grab("notes-test-notes.json");
  ok(ntext!==null, "the JSON is written under the file's own name");
  const nd = ntext ? JSON.parse(ntext) : {records:[],other:[]};
  ok(typeof nd.description==="string" && nd.generated==="2026-08-19",
     "the wrapper keys come back untouched");
  ok(nd.records[0].notes==="edited on the page", "an edited note replaces the one in the file");
  ok(nd.records[1].notes==="added where there was none", "a new one is written where there was no field");
  ok(!("notes" in nd.records[2]), "the record whose note was empty in the file loses the field");
  ok(!("notes" in nd.records[3]), "and so does one whose note was cleared on the page");
  ok(nd.other[0].notes.by==="someone", "the sibling array is not touched at all");

  console.log("\n== a notes field that is not a note ==");
  await ev(`(()=>{const s=document.querySelector('#recordArray');
     s.value='other'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(400);
  ok(await ev(`state.notesAdopted`)===false,
     "a column of objects is data of its own, and is left as data");
  ok(await ev(`NOTE_LABEL()`)==="notes (added)", "so a note written here takes a name of its own");
  ok((await ev(`document.querySelector('#cards .card').innerText`)).includes("notes"),
     "and the field keeps its place on the card");
  await type(0,"beside it"); await sleep(300);
  const j2 = JSON.parse(await ev(`notesJSONText()`));
  ok(j2.other[0]["notes (added)"]==="beside it", "the note goes in beside the data's field");
  ok(j2.other[0].notes.by==="someone", "which comes through exactly as it was");
  ok(j2.records[0].notes==="kept from the file",
     "and the array that is no longer on screen keeps the file's own notes");
  await ev(`state.notes.clear(); state.notesDirty=false; renderNoteBtn()`);

  ok(errors.length===0, "no exceptions: "+JSON.stringify(errors.slice(0,2)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  ws.close(); chrome.kill(); process.exit(fail?1:0);
})().catch(e=>{console.error(e);chrome.kill();process.exit(1);});
