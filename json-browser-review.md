# JSON Browser Review — adequacy, efficiency, browser compatibility

Reviewed 2026-08-04, against `json/json-browser.html` at 1828 lines (commit `5c30a5a`
plus the uncommitted selection-and-copy work).

**Method.** The whole source, both readmes and the test harness were read; the six
unit suites plus the `messy` and `select` page suites were run (695 assertions in
those runs, all passing). Three purpose-built probes were written and run: a Node
hot-path benchmark over code sliced out of the shipped HTML, a headless-Chrome
`file://` capability probe, and a headless-Chrome timing run on 100,000 records.
One bug was reproduced end to end in the real page.

**Confidence.** Findings are marked **[confirmed]** — read in the code or observed
in a run — or **[suspected]** — inference from the code and from published platform
support. Nothing inferred is presented as verified. The two headline findings
(§1.1, §1.2) were independently re-checked against the source.

---

## 1. Adequacy

### 1.1 Prototype-chain corruption in the OR machinery **[confirmed]**

The codebase is careful about field names that collide with `Object.prototype`:
lookup tables keyed by field name are built with `bare()` = `Object.create(null)`
(`json-browser.html:339`, `:613`), and `messy-test.json` plus `test-messy.js` exist
to prove a field called `__proto__` is "just a key".

Three tables miss that treatment and use a plain `{}`:

| where | table |
|---|---|
| `json-browser.html:959` | `makeClause`'s `byField` |
| `json-browser.html:967` | `liveClause`'s `spec.f` |
| `json-browser.html:1255` | `restoreFromParams`'s `saved[num] = {f:{},…}` |

Assigning `spec.f["__proto__"] = [...]` does not create a key — it sets the
object's **prototype** to that array. The subsequent `for (const k in spec.f)`
(`:961`) then enumerates the array's indices as inherited enumerable properties.

Reproduced against `messy-test.json`:

- Filter on the `__proto__` field, press **OR** → a garbage clause appears on a
  field named `"0"`, whose values are the characters of `"[object Object]"`. The
  clause chip reads `0: [ / o / b / j / e / c / t / …`, the record count drops to
  0, and the URL becomes `?…&f1.0=%5B,o,b,j,e,c,t,+,O,%5D`.
- Opening a URL containing `f1.__proto__=x` throws
  `TypeError: ….push is not a function` inside `restoreFromParams` (`:1256`). The
  boot IIFE's bare `catch` (`:1820`) swallows it and shows the "No JSON loaded"
  empty state *underneath* the already-rendered cards; the URL is never normalized.

**What a user sees.** Pressing OR eats their filter and shows zero records; a shared
link carrying such a filter half-breaks the page.

**Fix.** Use `bare()` for all three tables.

### 1.2 `k in r` walks the prototype chain, inventing values **[confirmed]**

`analyze` (`:618`), `fieldOK` (`:937`) and `computeFacets` (`:1007`) test field
presence with `isRec(r) && (k in r)`. `"__proto__" in {}` is always true — it is an
accessor on `Object.prototype` — so every record *lacking* a literal `__proto__` key
reports `Object.prototype` as its value.

Observed: the `__proto__` facet panel for `messy-test.json` lists a phantom value
`[object Object]`, contributed by a record that has no such key, and it is
filterable and counted. The same applies to any field named `constructor`,
`toString`, `valueOf`, and so on.

`test-messy.js` asserts that `__proto__` is "just a key" but never opens its facet
panel, so this was never exercised.

**What a user sees.** Fake facet values, and wrong missing/present counts, on any
prototype-named field.

**Fix.** `Object.hasOwn(r, k)` (or `Object.prototype.hasOwnProperty.call`).

### 1.3 "all" only ticks the rendered rows **[confirmed]**

`toggleAllValues` (`:886-890`) iterates the checkboxes present in the DOM, and
`paintVals` caps rendering at 1000 rows (`:876`). On a field with 5000 distinct
values, **all** silently selects the first 1000. With the type-ahead active it
selects only the matching subset — that half is arguably the point, but the
interaction with the cap is a silent truncation that `json/readme.md:144`
("**all** / **none** to bulk toggle") does not admit.

**What a user sees.** "all" pressed, thousands of values still unselected, no
indication why.

**Fix.** Operate on `state.values[k]` rather than on the DOM, or relabel to
"all shown".

### 1.4 OR-button enabled state goes stale **[confirmed]**

`renderClauses` (`:909-910`) is the only writer of `#orFilter.disabled`, but the
metadata-panel field toggles (`:1682-1708`, `:1717-1722`) and `pickField` (`:1747`)
call `syncFieldUI()` and `apply()` without it.

- Hide the only filtered field → OR stays enabled but clicking does nothing (the
  guard at `:1624` catches it).
- Unhide a field carrying a suspended filter → OR stays disabled, and the revived
  filter cannot be saved until some other filter is touched.

Harmless, but inconsistent. **Fix.** Call `renderClauses()` from those handlers.

### 1.5 Documentation that does not match the code **[confirmed]**

- `json/readme.md:51-53` claims the page "sends `Cache-Control: no-cache`, so a
  refresh always re-reads both the data and the viewer". It is a
  `<meta http-equiv>` (`json-browser.html:5`), which browsers ignore for HTTP
  caching. The *data* is in fact re-read, but because of
  `fetch(…, {cache:"no-store"})` (`:1783`, `:1811`); nothing guarantees the viewer
  HTML itself is.
- `json/readme.md:392-395` and the code comment at `:1569-1571` claim `file://` is
  not a secure context and so falls back to the legacy copy path. False in Chrome:
  the probe reports `isSecureContext === true` with `navigator.clipboard.write` and
  `ClipboardItem` both present. The same holds in Firefox. The async path is what
  actually runs there. Behavior is fine; the stated mechanism is wrong.
- Minor: a `?q=` restored from a URL is lowercased but not trimmed (`:1235`),
  unlike typed input (`:1738`), so a hand-built `?q=+foo+` behaves differently from
  typing " foo ".

### 1.6 A bad `?file=` fails silently **[confirmed]**

The boot catch (`:1820-1823`) shows the plain "No JSON loaded" empty state with no
hint that the URL named a file that 404'd or was blocked by CORS. The interactive
`loadFromURL` path does alert (`:1786`).

**What a user sees.** A shared link that "doesn't work", with no explanation.

### 1.7 Primitive records are half-supported **[confirmed]**

Primitives among the records render as `(untitled)` cards and are counted — asserted
by `test-messy` — but `searchOK` (`:943-949`) uses `for (const k in r)`. A number or
boolean record has no enumerable keys and can never match a search; a string record
enumerates its *characters*, so only single-character queries match it.

**What a user sees.** Search silently never finds bare-value records.

### 1.8 Smaller confirmed nits

- `parseQuery.many()` (`:1217`) is dead code.
- `valKey` (`:340`) merges `1`/`"1"` and `true`/`"true"` into one facet bucket.
  Reasonable, but undocumented.
- Two `dblclick` listeners are bound to `#cards` (`:1647`, `:1672`). Both run on
  every double-click; each guards itself, so it works, but it is fragile.

### 1.9 What is well done **[confirmed]**

- **No XSS.** All 15 `innerHTML` sinks were audited (`:633`, `:684`, `:742`, `:804`,
  `:811`, `:881`, `:902`, `:1321-1326`, `:1369`, `:1589`, `:1666`, `:1699`). Every
  data-derived string passes through `esc()` (`:334`), including values placed into
  attributes (`data-val`, `title`, `href`). Link targets are constrained to
  `https?:` or `data:image/` (`:1304`, `:510-515`), so there is no `javascript:`
  route, and resolver-built URLs are prefix-anchored. The clipboard HTML is escaped
  on the same path.
- The messy-fixture basics genuinely hold: null and primitive records, empty-string
  field names (the `data-k` sentinel at `:777-779` is a neat solution), mixed arrays.
- Honest faceting (`computeFacets`, `:994-1013`) implements the correct
  "fails at most its own field" rule in O(records × active filters), and the
  checked-value-with-count-0 rescue in `paintVals` (`:877-880`) closes a real trap.
- Missing-values-last in both sort directions (`:1113-1120`), stable ties, and the
  hoisted collator (`:1100`) are all correct.
- URL round-tripping — split-before-decode (`:1206-1218`), packed parameters —
  holds up against commas and `=` inside values, and old spellings still parse.

### 1.10 Test-suite honesty

All suites pass as claimed. Three real gaps:

1. **`legacyCopy`/`execCommand` (`:1583-1600`) is executed by zero tests.** Headless
   Chrome on `127.0.0.1` always takes the async path, so the fallback that plain
   `http://` and older browsers depend on is validated nowhere.
2. The `__proto__` fixture exists, but no test filters on it, opens its facet panel,
   or presses OR with it — exactly where §1.1 and §1.2 live.
3. No keyboard or accessibility assertions anywhere; one `aria-expanded` read in
   `test-interaction.js:1150` is the whole of it.

### 1.11 Accessibility **[confirmed by code read]**

- The two bulk gestures — double-click a select box to take the page (`:1647`),
  double-click a summary to open a field on every card (`:1672`) — have **no
  keyboard and no touch equivalent**. Touch is precisely where `dblclick` does not
  exist.
- Copy success and failure are a 900 ms color flash only (`:1605-1608`): not
  announced, not textual, and green-versus-red is a colorblind trap.
- `#selCount` and `#resCount` change without `aria-live`.
- The OR help exists only as a `title` tooltip (`:267-271`) — unreachable on touch,
  largely unread by screen readers.
- **all**/**none** in the metadata panel triggers a full `renderMeta()` (`:1715`,
  `:1722`), destroying the focused button.
- Contrast: muted `#6b7280` on white is ≈ 4.75:1 (passes AA); on the `#f4f5f7` page
  background it is ≈ 4.35:1, which fails AA's 4.5:1. Affects the empty-state text.
- Good: `aria-expanded`/`aria-controls` on the sidebar toggle, `aria-label` on the
  select boxes, and native `details`/`summary` plus labeled checkboxes, all
  keyboard-operable.

---

## 2. Efficiency

### 2.1 Measurements

Real page, headless Chrome, 100,000 records × 10 fields, 30 MB JS heap:

| operation | time |
|---|---|
| `apply()` baseline (filter + facets + render + URL) | ~60 ms |
| `apply()` with one value filter | 18 ms |
| `apply()` with a two-level sort | 222 ms |
| `apply()` with a 5000-value facet panel open | +70 ms |
| `renderCards()`, page of 100 | 2 ms |
| `apply()` at page size `all` (100k cards) | 2.1 s |

Node benchmark over the sliced shipped code, 1M × 10: search 220 ms, full facet
fan-out 3.3 s, two-level sort 13.5 s. The page was roughly 5× faster than Node on
sort at 100k, so read these as orders of magnitude.

### 2.2 Verdict by size **[confirmed]**

- **10k** — effortless everywhere.
- **100k** — comfortable. `json/readme.md:453` ("comfortable into the tens of
  thousands") is honest, even conservative — except when a sort is active.
- **1M** — out of reach with a sort or many fields: multi-second stalls per
  interaction.
- Wide records scale linearly as expected (50 fields ≈ 5× facet cost). At
  100k × 100+ fields the facet fan-out alone reaches seconds.

### 2.3 The one structural inefficiency that matters

**`apply()` (`:1121-1158`) redoes everything on every call.** Every pager click,
page-size change and clause edit re-runs the search, re-filters, **re-sorts from
scratch**, recomputes all facets and rewrites the URL. Paging through a sorted 100k
dataset costs ~220 ms *per page turn* for work whose inputs did not change.

Two fixes, in order of value:

1. **Skip the sort and filter when nothing they depend on changed** — a dirty flag
   or an input signature over search/filters/sort. Paging becomes the 2 ms it ought
   to be.
2. **Precompute sort keys** (Schwartzian transform). `cmpVals` (`:1104-1109`) does
   two `+a` numeric coercions and possibly a collator compare on every comparison,
   O(n log n) times. Comparing precomputed keys would cut large-n sort several-fold.

### 2.4 Real but smaller

- `sortHasTies` (`:1092-1097`) adds an O(n × levels) adjacent scan per `apply()`. It
  early-exits on the first tie (0 ms in these runs) but is a full scan when the sort
  is unique — a few hundred ms at 1M, negligible at 100k.
- `searchOK` (`:943-949`) stringifies nested objects with `JSON.stringify` per record
  per search run. A lazily built lowercase haystack per record would make search a
  scan over prebuilt strings. At 100k it is only 14 ms, so this is worth doing only
  if 1M becomes a target.
- The debounce threshold (`:1741`) is 0 ms below 2000 records — correct there — and
  150 ms above, which is adequate to roughly 200k given the measured `apply()` cost.
- An open large facet panel repaints up to 1000 rows per `apply()` (`:869-885`).
  Visible, but bounded.

### 2.5 Not worth touching

`GATED` memoization, the cost of `esc`, string-concatenation HTML building (a
100-card page renders in 2 ms), the per-`apply` `querySelectorAll(".ffield")`
sweeps, and memory (30 MB per 100k records). Page size `all` producing a 2 s render
and heavy scrolling at 100k is a self-inflicted setting and acceptable.

---

## 3. Compatibility

### 3.1 Feature inventory **[confirmed by read]**

**JavaScript** — ES2017-2019 level: `Object.entries`, spread, `Set`/`Map`, `for…of`,
`async`/`await`, `flatMap` (only in the dead `many()`). No optional chaining, no
nullish coalescing, no `structuredClone`, no class syntax.

APIs: `Intl.Collator` with `numeric` (`:1100`); `matchMedia` plus
`.addEventListener("change")` (`:1770-1776`); `history.replaceState` (`:1203`); a
hand-rolled query codec — **no** `URLSearchParams`, which avoids its `+` and
repeat-key quirks; `fetch` with `cache:"no-store"`; `FileReader`; drag and drop;
`getSelection`/`Range`; the async Clipboard API (`navigator.clipboard.write` with
`ClipboardItem`, two flavors, `:1572-1582`) with a `document.execCommand("copy")`
fallback (`:1583-1600`); `loading="lazy"`, `decoding="async"`,
`referrerpolicy="no-referrer"` (`:554`).

**CSS** — grid template areas, flex/grid `gap`, `clamp()`, `aspect-ratio`,
`accent-color`, `object-fit`/`object-position`, `inset`, `details`/`summary`,
`[hidden]` re-assertion. No `:has()`, no container queries, no `dvh`.

### 3.2 What a user actually gets

**Chrome / Edge, any recent version — [confirmed].** Everything works, `file://`
included: the probe reports `isSecureContext === true`, the clipboard API present,
`history.replaceState("?…")` succeeding, and relative `fetch` failing — so `?file=`
correctly degrades to the picker and drag-and-drop, as documented. The copy buttons
take the full async path, verified by the test suite against a real clipboard.

**Firefox — [suspected]**, not run. Every API used is supported. `ClipboardItem`
shipped enabled in Firefox 127 (June 2024); on older versions the guard at `:1573`
fails cleanly and the `execCommand` fallback runs, which Firefox supports. `file://`
is a secure context there too. Silent degradation only.

**Safari desktop — [suspected]**, working from 15.4 over http(s). The copy path is
built correctly for Safari's strictness: `navigator.clipboard.write` is reached
synchronously within the click (no `await` precedes it in
`copySelection` → `copyOut`), and `ClipboardItem` carrying `text/plain` plus
`text/html` Blobs has been supported since roughly 13.1/14. So S and F *should*
work — but this is the newest feature and it has only ever been exercised in
headless Chrome. Two Safari-specific risks, both inference:

1. If `write()` rejects, the fallback's `execCommand` runs *after* an `await` and may
   find the user activation already consumed → red flash, nothing copied.
2. WebKit throttles `replaceState` to roughly 100 calls per 30 s, and `syncURL` runs
   on every `apply()`. Below 2000 records the search debounce is 0 ms, so fast typing
   plus clicking could trip a `SecurityError` mid-`apply`. Rendering completes first —
   `syncURL` is last — so the visible failure is a console full of errors and a URL
   that stops updating.

Hard version floor: **Safari ≤ 13.1 dies** at `NARROW.addEventListener` (`:1776`) —
a `TypeError` that kills everything defined after it (the file loaders, drop
handling, boot), leaving a blank, unusable page. Safari 14.0 loses square thumbnails
(`aspect-ratio`, `:161`; images render at natural aspect, silently), flex layouts
without `gap` jam together (fixed in 14.1), and `accent-color` and `loading="lazy"`
are silently absent before 15.4. That is all 2019-2021 Safari and reasonable to
ignore — but the ≤ 13.1 case is a hard failure, not a degradation.

**iOS Safari.** The ≤ 820px stacked layout with `height:auto` (`:39-44`) neatly
sidesteps the 100vh toolbar problem. Copying over https should work — async
clipboard since iOS 13.4, same synchronous-in-gesture reasoning — **[suspected]**,
untested. Drag and drop is not applicable; the file picker works. **Confirmed gap:**
both double-click bulk gestures are simply unavailable on touch, since double-tap is
zoom or text selection, and there is no alternative control. An iPad user cannot
select a page of records except one checkbox at a time — which makes the new copy
feature tedious exactly where pasting into Mail is most likely.

**Plain `http://` to a non-localhost host.** `isSecureContext` is false, so every
copy goes through `execCommand`. This is the only path such users have, and it has
zero test coverage (§1.10). It should work everywhere `execCommand` survives, which
is all current browsers, deprecated but shipped — **[suspected]**.

### 3.3 Degrade versus hard-fail

Almost everything degrades silently: thumbnail cropping, accent color, lazy loading,
referrer policy, and the copy dropping a tier. The only hard failures found are
Safari ≤ 13.1 (page dead) and the §1.1 `__proto__` URL restore (page half-dead) —
one environmental, one data-driven.

---

## 4. Priorities

### Fix first

1. **The prototype patch (§1.1 + §1.2), one small change.** Use `bare()` for
   `makeClause`'s `byField` (`:959`), `liveClause`'s `spec.f` (`:967`) and
   `saved[num].f` (`:1255`); replace `k in r` with `Object.hasOwn(r, k)` at `:618`,
   `:937` and `:1007`. Then extend `test-messy` to press OR on `__proto__` and open
   its facet panel — the fixture already exists.
2. **Skip redundant work in `apply()` (§2.3).** Do not re-filter or re-sort when
   search, filters and sort are unchanged, and precompute sort keys. This is the
   difference between 100k feeling instant and feeling sticky.
3. **Exercise the legacy copy path once** — stub `isSecureContext`/`clipboard` in a
   page test — and, if any Safari is available, click S and F there once. It is the
   new feature's only untested tier.
4. **A touch and keyboard path for bulk select.** A "select page" control in the
   selection bar fixes iPad and keyboard in one stroke. Add an `aria-live` region
   and a textual signal for the copy result.
5. **Honesty fixes.** `toggleAllValues` beyond the 1000-row cap (§1.3); an alert on a
   failed `?file=` boot (§1.6); the two readme corrections (§1.5); call
   `renderClauses()` from the hide/unhide handlers (§1.4).

### Safe to ignore

1M-record ambitions; `valKey` type-merging; primitive-record search; the dead
`many()`; Safari ≤ 14 CSS degradations; the `#f4f5f7` contrast marginality, unless
AA compliance is a goal; and every micro-optimization — the rendering layer is
already lean.
