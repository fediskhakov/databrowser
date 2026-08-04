# JSON DB Viewer (`json-browser.html`)

A single-file, dependency-free web app for browsing, filtering and sharing views of
**any** JSON dataset. Markup, CSS, JS and the favicon all live in one
`json-browser.html` — no build step, no backend, and no network calls beyond
fetching the file you point it at.

Nothing is hard-coded to a dataset: it inspects whatever JSON you load, finds the
record array and the fields, and builds the interface around them.

![The viewer on the bundled dataset](screenshot.png)

*Above, on `econ_departments.json`: records sorted by country and then by score
descending; one [saved filter set](#combining-sets-of-filters-with-or) OR-ed with
the panels, showing that it matches 230 records of which 209 depend on it; filter
values ordered [commonest first](#filtering) (numeric fields by value); and
`repec_id` values resolved into
[EDIRC links](#identifiers) with long URLs collapsed to what following them does.*

---

## Quick start

```bash
cd json
./serve-json.sh path/to/data.json                   # default port 8753
./serve-json.sh path/to/data.json 9000              # custom port (a bare integer)
./serve-json.sh path/to/data.json q=harvard ps=all  # open with a preset view
```

`serve-json.sh` symlinks the viewer and your JSON (from anywhere on disk) into a
temp directory, serves it on `127.0.0.1`, opens the browser at the right `?file=`
URL, and tears it down on Ctrl-C. Extra arguments become query parameters, so you
can launch straight into a preset view — see [Shareable URLs](#shareable-urls).

To serve it yourself, run any static server from the directory holding
`json-browser.html`. A server is needed for `?file=` and shareable links because
browsers block `fetch()` on `file://` URLs. You can still open the file directly
from disk — the **Load file…** button and drag-and-drop work there, the rest
doesn't.

## Loading data

- **`?file=<path-or-URL>`** — resolved relative to the page, or an absolute URL the
  server's CORS policy allows. The only method that participates in shareable links.
- **Load from URL** / **Load file…** — in the *Metadata & dataset info* panel, and
  also on the start page. A URL load is written into `?file=`, so the view becomes
  shareable.
- **Drag and drop** a `.json` file anywhere on the window.

With no `?file=` the app starts blank; there is no default dataset. The page sends
`Cache-Control: no-cache`, so a refresh always re-reads both the data and the
viewer — handy while a dataset is being regenerated.

## Records and fields

On load the app scans the top level: if the root is an **array**, its elements are
the records; if it is an **object**, every array-valued key is offered as a
candidate and it auto-selects the first of `authors, records, data, items, rows,
results`, else the first array found. An object with no array child is shown as a
single record. Every other top-level key becomes dataset metadata. Change the choice
with **Main record array** in the metadata panel.

A field is **scalar** if its value is never an object or array *in any record*.
Scalar fields get filters, sorting and key/value rows. A field that is sometimes an
object or array is **nested**, and appears as a collapsible expander instead.

---

## Layout

- **Header** — the **☰** panel button, filename, **search** box, live record count,
  pagination (hidden when *Records per page* is `all`), and — once something is
  ticked — the [selection bar](#selecting-and-copying).
- **Left panel** — **Sort**, **Filters** (its buttons — including **⧉**, which
  [copies the filters in words](#copying-the-filters-in-words) — any saved filter
  sets, then a collapsible panel per scalar field), and **Display** options.
- **Main area** — the collapsed *Metadata & dataset info* panel, then the records.

**Small screens.** ☰ folds the panel away entirely. Below 820px the layout stacks
instead of squeezing: the panel becomes a scrollable band above the records and
starts folded, so a phone shows data first and controls on demand. Crossing the
breakpoint resets that default; a click on ☰ overrides it until the next crossing.
This is deliberately *not* in the URL — a shared link shouldn't carry your screen
width.

---

## Sorting

The **Sort** dropdown orders records by any switched-on field. Every field is listed
twice — `world_rank ▲` ascending, `world_rank ▼` descending. `(file order)` is the
default.

**Ties open another level.** If the chosen field has repeated values, a second
dropdown appears indented below the first, then a third, each ordering only what the
levels above left tied:

```
SORT
  country ▲
    category ▲
      world_rank ▼
```

A level is offered only while ties remain — a unique field ends the cascade at once
— and it stops at three. Each level has its own direction; `(none)` drops it and
everything below.

**How values compare.** Numbers, and strings that are numbers, compare numerically
(`9` before `10`); text compares case-insensitively with embedded digits still
ordered numerically (`item2` before `item10`); booleans put `false` first; ties keep
file order. Records **missing** the field sort last in *both* directions —
reversing the data shouldn't dredge empty rows to the top.

**Surnames.** A field called exactly `name` (any capitalization) gets two extra
options ordering by the **last word**: `Grace Hopper, Ada Lovelace, Madonna, John von
Neumann, Ann Smith, John Smith, Alan Turing`. One-word names sort on themselves,
multi-part surnames on their last word, and equal last words fall back to the whole
name so the Smiths land together *and* in order. Widen the one-line `NAME_FIELD`
regex to recognize a differently-named column.

The whole result is sorted, not just the visible page, and the underlying data is
never reordered — `(file order)` restores it exactly. Switching a sort field off
suspends that level and promotes the ones below it.

---

## Filtering

Each switched-on scalar field gets a collapsible panel:

- **not missing** / **missing** checkboxes with counts (missing means `null`,
  `undefined` or empty string);
- a checkbox per **value** with its count, **commonest first** — ties fall back to
  value order. **Numeric fields are the exception**: a column whose values are
  numbers is a scale rather than a set of labels, so it is listed **in ascending
  numeric order** instead, keeping years or scores in sequence. A column counts as
  numeric when at least 90% of its distinct values parse as numbers end to end —
  `2020 Census` and `45%` do not, so a text column that merely starts with digits
  keeps count order. The verdict is taken once from the whole dataset, so filtering
  never changes a panel's ordering rule. Many-valued fields get a type-ahead; the
  list shows at most 1000 entries, though a value you have checked always stays
  visible;
- **all** / **none** to bulk toggle.

Within a field values are **OR**-ed; across fields, **AND**-ed. **Reset filters**
clears everything, saved sets and search included.

### Honest faceting

As soon as anything is filtered, every *other* field's panel shows only the values —
and counts — still reachable. Values that can no longer occur drop out; a value you
have already checked stays visible (with count 0) so you can uncheck it. The field
you are actively filtering keeps all of *its* options, so you can always broaden it.

### Combining sets of filters with OR

The panels express one set of constraints. To ask for *US economics departments **or**
UK business schools* — two combinations at once — press **OR**. The current panels
are saved as a set, summarised above the field list, and cleared for the next one:

```
SAVED FILTERS — ANY OF THESE
✕  country: United States                  154  ×78
✕  category: economics_dept                230 ×119
✕  country: United Kingdom                  37  ×16
```

A record is shown when it matches **any** saved set, or the set you are currently
building (which counts as one more — empty panels add nothing). Each set carries two
numbers: how many records **match** it, and how many would **disappear if removed**.
They differ when sets overlap — above, only 78 of the 154 US records depend on the
first set, the rest being economics departments the second shows anyway. A set
reading `×0` is fully covered by the others. **✕** removes a set.

The global **search** stays outside the sets, narrowing whatever they produce, and
the facet counts keep describing the set you are *building*, so the panels remain
usable for composing the next one. A saved set is static: it keeps applying even if
one of its fields is later switched off.

### Copying the filters in words

The **⧉** button in the filter pane's button row copies a plain-text description of
what is currently filtered — for pasting into a note or a message beside the records
themselves, so the numbers you quote come with the question they answer:

```
econ_departments.json — 158 of 379 records

search: school

any of these sets:
  1. country: United States or Canada, and category: economics_dept   (9 records, 0 only here)
  2. country: United Kingdom   (26 records, 0 only here)
  3. repec_authors: not missing   (the panels, as they stand)
```

Values within a field are joined with **or** and fields with **and**, matching how
they actually combine; saved sets are listed as the union they are, each with the
same two counts its chip shows, and the panels appear last as one more set. Without
saved sets it is simply the count and a line per field. It describes only what
*applied*: a filter [suspended](#switching-fields-on-and-off) because its field is
switched off is absent here exactly as it is absent from the result. The button is
never disabled — "no filters — every record is shown" is a description too.

---

## Display options

| Option | Effect |
|--------|--------|
| **Records per page** | `100` / `500` / `1000` / `all` (hides the pager) |
| **Card title field** | Card heading; defaults to the first of `name, title, display_name, label, id, uid`, else the first scalar field |
| **Card subtitle field** | Optional smaller heading; `(none)` by default |
| **Card image field** | Which column supplies the [thumbnail](#images) |
| **View** | `cards` (grid) or `full-width records` (one per row) |
| **Auto-link IDs** | Turns recognized [identifiers](#identifiers) into links |

The title and subtitle fields are omitted from the card body to avoid repetition.

---

## Metadata & dataset info panel

Above the records, holding everything about *what* is loaded: the **loaders**, the
**main record array**, the record and field counts, the identifier schemes and image
columns detected, and every non-record top-level key of the file. A key whose value
is an object has its entries listed at the same level rather than spending a whole
indentation layer on the wrapper (only that layer — anything deeper still nests).

### Switching fields on and off

Every field in the inventory has a checkbox. Unchecking one removes it from the
records **and** from the filter list, and stops its facets being computed. The
**all** / **none** buttons switch a whole group.

If that field carried a filter, the filter is **suspended** rather than dropped:
matching widens as though it were cleared, the record count updates immediately, and
its chip turns accent-coloured. Switch the field back on and the panel returns
exactly as you left it — same open state, same checked values — and the filter
reapplies. The same applies to a sort level.

The **title and subtitle fields cannot be switched off** (they are in the heading);
their boxes show fixed on and **none** skips them. Global search still matches
switched-off fields — search is for finding records, not for choosing what to show.

Below these rows sits a third one of the same shape, **short copy fields**, which
picks what the **S** button copies rather than what the page shows — and there the
title and subtitle *can* be unticked, since nothing about the card depends on it.
See [choosing what the short copy prints](#choosing-what-the-short-copy-prints).

---

## How records render

- **Cards** show the title, optional subtitle, then one `key: value` row per
  non-empty scalar field. **Empty fields are hidden.**
- **Nested fields** appear as collapsible `field (n)` expanders, rendered lazily:
  an array of objects renders each item compactly (a `title`/`name` gets any of
  `journal, venue, source, year, date` appended); an array of scalars renders as
  chips; an object renders as nested rows. **Double-click** an expander to open that
  field on *every* card at once, and again to close them all.
- **Values** are formatted by type: booleans get a true/false pill, `null`/empty
  shows as an em dash, and URLs and recognized identifiers become links.

### Long text

A column whose values run long — an abstract, a description — is not squeezed into
the value column. On a **card** it becomes a collapsible section across the full
width, with the opening words as a teaser; in **full-width** view, where there is
room already, it is printed in place. Newlines in the value are ordinary
whitespace, so text hard-wrapped in the source file doesn't arrive pre-broken.

Decided per column, so cards stay uniform: a column qualifies when the 90th
percentile of its values, weighted by record, prints longer than 160 characters. One
freak value doesn't move a column, and what counts is what a value *prints* — a
column of long URLs isn't long text, since those collapse to a short label.

### Links

A URL in the data longer than 20 characters is replaced by a label saying what
following it does — judged from the file extension, the only clue available without
fetching anything:

| The URL points at | Label |
|---|---|
| an image | `show image` (always, whatever the length) |
| a PDF | `download pdf` |
| another downloadable file | `download` |
| anything else | `open <field>` |

The full address stays in the link and its tooltip. `…/paper.pdf#page=3` downloads;
`…/pdf/browse` opens.

### Identifiers

Values recognizable as persistent identifiers link to their canonical resolver, so a
bare `10.1257/aer.20190623` becomes clickable without the data carrying a URL. The
**displayed text is always the identifier** — only the target is derived, and it is
never collapsed the way a long URL is. Resolved links look exactly like URLs that
came with the data; their tooltip names the scheme. Nothing is fetched while
rendering.

Recognized: **DOI**, **ORCID**, **arXiv**, **PMCID**, **PubMed**, **RePEc** (EDIRC),
**OpenAlex**, **ROR**, **ISSN**, **ISBN**, **Wikidata**, **SSRN**, **Semantic
Scholar**, **Handle**, **VIAF**, **ISNI**, **GitHub**, email, and bare hostnames.

Detection is conservative, in three tiers: *self-identifying* values (a DOI, an
ORCID) link anywhere; ambiguous ones need the **field name** to match too
(`pmid: 12345678` links, `world_rank: 12345678` does not); distinctive patterns with
no name hint (a bare OpenAlex ID in a field called `id`) link only when ≥90% of the
column matches. Add a scheme by adding one row to the `LINKERS` table; set
**Auto-link IDs** to `off` to disable it (`links=0`).

### Images

A column of image URLs is shown as a **square thumbnail** — top right of a card,
sharing the top line with the title, or at the right of a full-width row. One size
for every record, scaling with the viewport (43–80px). The picture fills the square,
cropped **from the top** so portraits keep faces rather than midriffs. Clicking opens
the full image.

A value counts as a picture if it is an `http(s)`/protocol-relative URL ending in a
known image extension, a `data:image/…` URI, or *any* URL in a field named like a
picture (`photo`, `avatar`, `logo`, `thumbnail`, …). The **Card image field** select
offers every column holding at least one picture, and defaults to the first that is
*mostly* pictures — so a stray image URL in a column of notes never hijacks the
cards, but you can still pick it. Every other picture renders as a **show image**
link. A missing value gets no thumbnail; a URL that fails to load collapses its box.

Thumbnails are the one thing besides your JSON that the viewer fetches. They load
lazily and with `referrerpolicy="no-referrer"`, and switching the column off stops
them entirely; `data:` URIs never touch the network.

---

## Selecting and copying

Every record carries an unlabelled **checkbox in its bottom-right corner** — of the
card, or of the row in full-width view. **Double-click** one to tick every card on
the page at once, and again to clear them — the page, so under a filter it takes
exactly what the filter left, and with *Records per page* at `all`, everything.
Tick one and a bar appears at the right of the header, the search box giving up the
width for it:

```
                                            2 selected  ✕  [⧉S]  [⧉F]
```

The two blue buttons copy the selected records to the clipboard: **S** is the
*short* copy — plain text, carrying only the fields you
[chose for it](#choosing-what-the-short-copy-prints) — and **F** the *full* one,
rich HTML with every field the card shows. Their tooltips say which is which. **✕**
clears the selection.

**What is copied** is what the cards show: the same fields, in the same order,
honoring [switched-off fields](#switching-fields-on-and-off), the chosen title and
subtitle, and the picture column. Empty fields are left out, as on screen.

**The records come out in the order the page is sorted** — one rule, whether or not
a record is on screen at the moment you press the button. Change the sort and the
next copy follows it. A selected record that the current filters hide takes its
place in that order too, rather than being tacked on at the end, so narrowing the
view to find the next record to tick never disturbs the order of what you already
have.

**The selection follows its records, not their positions.** Filter, sort, page or
search all you like: what you ticked stays ticked, and a record hidden by a filter
stays in the basket until you untick it or clear. Changing the *main record array*
empties it — those records are gone. Selections are **not** written into the URL: a
shared link carries a view, not a basket.

**S, as text** — a block per record, blank line between, the title (and subtitle) on
top and the fields indented beneath. Values print in full, since text cannot hold a
link: a URL shown on screen as `open homepage` arrives as the address itself, and an
identifier as the identifier. Arrays of scalars stay on one line, arrays of objects
get a line each. Newlines inside a value become spaces — the page does not show
them as breaks, so neither does the copy.

```
Ada Lovelace — Analyst
  orcid: 0000-0002-1825-0097
  homepage: https://example.org/people/ada-lovelace/profile/page
  works (2):
    Note G — Memoirs, 1843
    Sketch of the Analytical Engine
```

### Choosing what the short copy prints

The metadata panel carries a **short copy fields** row directly under the display
toggles, marked with a small copy of the **S** glyph and working the same way: a
checkbox per field, **all** / **none** to bulk toggle, and a count of what is
currently left out. Everything starts ticked.

Unticking a field removes it from the **S** copy only — the page is unchanged, and
so is the **F** copy, which always prints everything shown. A field switched off in
the rows above is in no copy at all, so its chip here is greyed out.

Unlike the display rows, this one offers **the title and subtitle too**: they cannot
leave the card, but a short copy may well want neither. Untick the subtitle and the
heading is the title alone; untick the title and the subtitle stands by itself,
without its dash. Untick both and the block has no heading, so its fields sit at the
margin rather than indented under nothing — and a record with nothing left to print
contributes no block at all. **none** takes the heading out with everything else.

The choice rides in the URL as `h2`, exactly as the display switches ride in `h`, so
a link you share reproduces it.

**F, as HTML** — the cards, to paste into a mail composer and have them arrive looking
like the page: same borders, headings, key/value rows, chips, thumbnails and links.
Mail clients drop `<style>` blocks and class attributes, so every rule is written
inline and the rows are a table. Two differences from the screen: collapsible
sections are printed open, because an email cannot hold one, and the card layout is
used even in full-width view, because a mail column is narrow.

**F carries a text version too**, alongside the HTML, so a plain-text field pasted
into still gets something readable. That text is the *full* record — the short
copy's field choice belongs to **S** alone, and applying it here would let a paste
into a plain editor arrive narrowed, or empty.

Copying needs a **secure context** — `https://`, or the `127.0.0.1` that
`serve-json.sh` gives you. Over plain `http://` to another host, or from `file://`,
the viewer falls back to the older copy path; if even that is refused the button
flashes red instead of green.

---

## Shareable URLs

Every filter, sort and display change is written back into the address bar via
`history.replaceState`. **Copy the URL at any moment and it reproduces the view.**

| Parameter | Meaning |
|-----------|---------|
| `file` | Path or URL of the JSON to load |
| `rec` | Record-array key (only when the file has more than one array) |
| `q` | Global search string |
| `sa` / `sd` | A sort level, ascending or descending. Repeatable — levels apply in the order they appear |
| `sla` / `sld` | The same, by [last word](#sorting) |
| `ps` | Records per page; omitted when `100` |
| `view` | `full` for full-width records |
| `links` | `0` disables identifier auto-linking |
| `t` / `st` | Card title / subtitle field |
| `img` | Card image field; empty (`img=`) means explicitly none |
| `page` | 1-based page number |
| `f.<field>=a,b,c` | Selected values for `<field>` |
| `p=<fields>` / `m=<fields>` | Fields whose "not missing" / "missing" box is set |
| `f<n>.<field>`, `p<n>`, `m<n>` | The same, for [saved filter set](#combining-sets-of-filters-with-or) `<n>` |
| `h=<fields>` | [Switched-off fields](#switching-fields-on-and-off) |
| `h2=<fields>` | Fields left out of the [short copy](#choosing-what-the-short-copy-prints) |

Anything repeatable is **packed into one parameter**: the field name appears once
however many values are selected, and flags name their fields instead of repeating
`=1`. A comma inside a value is percent-encoded (`Ecole%2C+Paris`), so the separator
can never be confused with the data. Only sort levels stay one per parameter —
packing them would lose their order.

Links written before August 2026 used a longer spelling (a repeated `f.<field>` per
value, `p.<field>=1`, `title`, `sub`, `sort`/`desc`/`last`, `__none__`). Those are
still understood; opening one rewrites it in the short form.

```
?file=authors.json&q=harvard&ps=all&m=phd_year&f.status=verified,student
```

→ load `authors.json`, show all matches for "harvard" among verified-or-student
authors whose `phd_year` is missing.

---

## Self-contained & private

One HTML file; no external scripts, fonts or stylesheets. All processing is
client-side — the only requests are the JSON you choose and, if the dataset has an
image column, the thumbnails. Files opened via the picker or drag-and-drop never
leave the browser. Copy the file anywhere and it works offline. Copying records to
the clipboard is likewise local: the two buttons build both flavors in the page and
hand them to the browser.

## Notes & limits

- Built for "browse and slice"; comfortable into the tens of thousands of records.
  Filtering and faceting are roughly `O(records × active filters)` per change, and
  the search box waits for a pause in typing on large datasets.
- The per-field value list shows at most 1000 entries — narrow with the type-ahead.
- A "scalar" field must be scalar in **every** record, or it is treated as nested.
- Identifier, image and long-text detection are heuristics keyed on value shape and
  English-language field names; each has an escape hatch (a `LINKERS` row, the image
  picker, the field switches).
- Field order follows JavaScript key order, so purely numeric field names sort ahead
  of the rest regardless of their position in the file.
- For `file://` use, only the picker and drag-and-drop work.
- A copied selection is a snapshot of the display, not of the data: it holds what
  the cards show, not the fields you switched off, and no JSON structure. The short
  copy narrows that further, to the fields ticked for it.

## Files

- `json-browser.html` — the viewer; everything is inside it.
- `serve-json.sh` — serves the viewer with a given JSON file and opens it.
- `example.sh` — sample invocation with a preset view.
- `readme.md` — this document.
- `tests/` — the test suites; `tests/run.sh` runs all of them. Needs node and
  python3, plus Chrome for the ones that drive the real page. See
  [tests/readme.md](tests/readme.md).

Fixtures, each exercising one rule and its near-misses:
`link-test.json` (identifier schemes), `image-test.json` (thumbnails, crop, picker),
`sort-test.json` (surnames, one-word names, missing values),
`text-test.json` (long text, embedded newlines, wrapper metadata),
`messy-test.json` (hostile shapes: a primitive among the records, a `__proto__`
field name, an empty field name, mixed arrays),
`copy-test.json` (everything the two copy buttons have to render: subtitle,
identifier, collapsed URL, thumbnail, long text, empty field, nested arrays).
