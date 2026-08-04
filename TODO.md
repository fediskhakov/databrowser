# TODO — rectifying the review findings

Work plan derived from [json-browser-review.md](json-browser-review.md) (reviewed
2026-08-04). Section numbers below reference that report. Nothing here is started.

Line numbers refer to `json/json-browser.html` as of the review; re-locate by symbol
if the file has moved on.

---

## Stage 1 — Correctness

Self-contained, roughly one commit. Closes the only crasher.

### 1.1 Prototype patch (report §1.1, §1.2) — small

Three tables keyed by field name use a plain `{}` where the rest of the file uses
`bare()` = `Object.create(null)`. Assigning a key called `__proto__` sets the
prototype instead of a property.

- `makeClause`'s `byField` — `:959`
- `liveClause`'s `spec` — `:967`
- `restoreFromParams`'s `saved[num]` — `:1255`

Field-presence tests use `k in r`, which walks the prototype chain, so every record
*lacking* a `__proto__` key reports `Object.prototype` as its value:

- `analyze` — `:618`
- `fieldOK` — `:937`
- `computeFacets` — `:1007`

**Divergence from the report.** It suggests `Object.hasOwn`, which raises the
platform floor to Safari 15.4 / Chrome 93. The file deliberately stops at ES2019 —
there is no optional chaining anywhere — so use a hoisted
`const own = Object.prototype.hasOwnProperty;` and call `own.call(r, k)`. Same fix,
no new floor.

**Tests.** Extend `test-messy` to: press OR while filtering on the `__proto__`
field; open that field's facet panel and assert no phantom `[object Object]` value;
round-trip `f1.__proto__=x` through the URL. The fixture already carries the field —
this is the gap that let both bugs through.

### 1.2 Boot error handling (report §1.6) — small

The boot IIFE (`:1805-1824`) wraps fetch, parse, `restoreFromParams` and `apply` in
one bare `catch`, then force-shows the empty state even when cards have already
rendered. Split it:

- fetch or parse failure → empty state, **with the reason** (status, or the parse
  error), rather than a bare "No JSON loaded";
- restore failure → keep the loaded data, still call `apply()`, log the error.

This also downgrades §1.1's second symptom from "half-dead page" to "page works, one
filter did not restore", which is the right failure mode for any future restore bug.

### 1.3 `toggleAllValues` past the 1000-row cap (report §1.3) — small

`toggleAllValues` (`:886-890`) walks the checkboxes in the DOM; `paintVals`
(`:869-885`) caps rendering at 1000 rows. On a field with more distinct values,
**all** silently selects the first 1000.

Extract the entry-building half of `paintVals` into `facetEntries(k, q)` — reachable
values, sorted, type-ahead applied, uncapped — and have both call it. `paintVals`
slices to 1000; `toggleAllValues` takes the whole list. The only semantic change is
the cap disappearing: facet reachability and the type-ahead filter both happen
upstream of the slice and are preserved.

Update `json/readme.md:144`, which currently describes **all** / **none** without
mentioning the cap.

### 1.4 Stale OR button (report §1.4) — trivial

`renderClauses()` is the only writer of `#orFilter.disabled` (`:909-910`). Call it
from the metadata field-toggle handlers (`:1682`, `:1717`) and `pickField` (`:1747`).

### 1.5 Readme corrections (report §1.5) — trivial

- `json/readme.md:51-53` — the `Cache-Control` claim. It is a `<meta http-equiv>`,
  which browsers ignore for HTTP caching; the data is re-read because of
  `fetch(…, {cache:"no-store"})`.
- `json/readme.md:392-395` and the code comment at `:1569-1571` — `file://` **is** a
  secure context in Chrome and Firefox, so the async clipboard path is what runs
  there, not the fallback.

---

## Stage 2 — Performance

### 2.1 Stop redoing work in `apply()` (report §2.3) — medium; the big win

`apply()` (`:1121`) re-runs search, re-filters, **re-sorts from scratch** and
recomputes all facets on every call, including a mere page turn (~220 ms per page
at 100k with a sort active).

Guard the two expensive stages with a **derived signature**, not a dirty flag — a
flag obliges every future mutation site to remember to invalidate it, and there are
a dozen.

`viewSig()` must cover exactly what the filter and facet passes read:

- a `dataRev` counter, bumped once in `setRecordSource`;
- `state.search`;
- `state.hidden` (it suspends live filters);
- each active live filter's values, `missing`, `present`;
- the serialized clauses.

Cost is O(selected values) — microseconds against the sort it saves. A second
signature over `activeSorts()` guards the sort and `renderSortSelects`. Paging then
falls through to slice + `renderCards` + `syncURL` only.

**Testable contract.** Ship three counters (`state.stats.filters / sorts / facets`)
incremented inside the guarded blocks; the page suite asserts a page turn increments
none of them while the rendered cards still change. Cheaper and far more durable
than a timing assertion.

### 2.2 Precompute sort keys (report §2.3) — medium

`cmpVals` does two numeric coercions per comparison and `lastWord` does a
`String.split` per comparison, O(n log n) times (`:1104-1120`).

Do **not** rewrite those functions: `test-sort` slices them out of the page as its
subject, and re-anchoring it would lose the 31 assertions that make this change safe.
Instead keep them as the reference implementation and add a
decorate-sort-undecorate fast path for `apply()` to use — per record per level,
precompute `{missing, num, str, lastStr}`, then compare precomputed keys.

**Differential test.** Over the sort fixtures, assert the fast path yields an order
identical to `state.filtered.sort(cmpMulti)`. That pins the two together
permanently while the existing comparator assertions keep guarding the semantics.

**Do 2.1 first.** It removes most of the pain; 2.2 is only worth its risk if
re-sorting still shows up afterwards.

---

## Stage 3 — Coverage and reach

### 3.1 Test the legacy copy path (report §1.10, §3.2) — small

`legacyCopy` (`:1583-1600`) is what every plain-`http://` user gets, and no test
touches it: headless Chrome on `127.0.0.1` always takes the async path.

In the page suite, `delete window.ClipboardItem` before the click — `copyOut`'s
guard then fails and the fallback runs — click S and F, read the clipboard back (the
suite already does this), assert both flavors arrive, then restore. No need to fake
`isSecureContext`.

If a Safari is available, click S and F there once by hand. It is the newest
feature's only untested tier.

### 3.2 Bulk select for touch and keyboard (report §1.11, §3.2) — medium

Double-click is the only way to select a page (`:1647`), and double-click does not
exist on touch — an iPad user cannot bulk-select at all, which is exactly where
pasting into Mail is most likely.

Add a control to the selection bar doing what the double-click does. The bar only
appears once something is ticked, so the sequence is: tap one checkbox, then the
control — one extra tap, versus currently impossible.

**Open decision:** bar-only (no permanent chrome, needs one tap first) versus always
in the header (immediately reachable, adds a control to every view). Recommendation:
bar-only.

Same item: `aria-live` on `#selCount`, and a textual copy result rather than colour
alone — the 900 ms green/red flash is currently the only signal, and it is a
colorblind trap.

---

## Not doing

Per the report's own "safe to ignore" list, plus:

- `searchOK` haystack precomputation — 14 ms at 100k; only matters if 1M becomes a
  goal;
- primitive-record search (`:943-949`);
- the `#f4f5f7` contrast marginality, unless AA compliance becomes a target;
- 1M-record ambitions, `valKey` type-merging, the dead `parseQuery.many()`, and
  Safari ≤ 14 CSS degradations.

---

## Order

1. **Stage 1** — one commit, ~an hour, closes the only crasher.
2. **Stage 2.1** — the item that changes how the app feels at scale.
3. **Stage 3.1** — cheap, and covers the tier nothing has ever exercised.
4. **Stage 2.2** — only if re-sorting still shows up after 2.1.
5. **Stage 3.2** — the only item carrying a design decision.
