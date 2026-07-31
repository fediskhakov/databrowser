# JSON Browser Auto-Link Plan

## Goal

Make well-known identifiers clickable in the JSON browser. When a displayed value
is recognizable as a persistent identifier — DOI, ORCID, OpenAlex ID, ROR, arXiv,
PubMed, ISSN, RePEc handle, and similar — render it as an `<a href>` pointing at
the canonical resolver, while still showing the original value as the link text.

Today `renderValue` (`json/json-browser.html:463`) links a value only if the
string itself starts with `http://` or `https://`. Everything else, including a
bare `10.1257/aer.20190623` or `0000-0002-1825-0097`, renders as inert text.

## Design Goals

- Keep `json/json-browser.html` self-contained: no dependencies, no build step.
- No network calls at render time. A link is only followed when the user clicks
  it, so the offline-first and privacy properties are unchanged.
- Purely presentational. Filtering, faceting, search, and the URL state operate
  on raw values exactly as they do now.
- Display the identifier verbatim. The link target is derived; the visible text of
  an auto-linked value is not rewritten or shortened.
- Conservative by default: a false link is worse than a missing one.
- Extensible in a few lines — one table of resolvers, readable by a non-author.
- Visually consistent with the URLs already in the data — one link style for
  everything the viewer renders. (An earlier draft marked resolved links
  differently; that distinction was dropped in favor of a uniform look.)

## Non-Goals for Version 1

- Fetching or validating identifiers (no HEAD requests, no checksum verification
  beyond cheap pattern shape).
- Rewriting or shortening identifier values.
- Linkifying identifiers embedded inside prose (abstracts, notes). Only whole
  field values are considered.
- Dataset-declared link templates (see Future Extensions).
- Per-resolver UI toggles.

## Detection Model

Detection combines two signals: the **field name** (leaf key) and the **value
pattern**. Neither alone is sufficient in general, so resolvers fall into three
tiers, checked in order.

1. **Verbatim URL** — value matches `/^https?:\/\//i`. Existing behavior, kept
   first and unchanged, so nothing that works today changes.
2. **Self-identifying (`SELF_ID`)** — the value alone is unambiguous, so it links
   in any field and at any nesting depth. Examples: `10.1257/aer.20190623`,
   `0000-0002-1825-0097`, `arXiv:2101.12345`, `PMC1234567`, `RePEc:edi:deharus`.
3. **Field-name gated (`NAME_GATED`)** — the value pattern is ambiguous on its
   own, so the leaf key must also match the resolver's field regex. `pmid: 12345678`
   links; `world_rank: 12345678` does not.
4. **Ambiguous, plan-promoted (`AMBIGUOUS`)** — a distinctive value pattern with
   no field-name hint, for example a bare OpenAlex ID `W2741809807` in a field
   called `id`. These link only if the field-level plan (below) found that
   effectively the whole column matches the same resolver.

First match wins; resolvers are ordered most specific first.

Field names are normalized before matching: lowercased, non-alphanumerics
collapsed to `_`. So `DOI`, `doi`, `Article DOI`, and `article-doi` all hit the
same gate.

### Field-level link plan

`analyze()` already walks every record and builds `state.values[k]`, a map of
distinct values per scalar field. Reuse it: after analysis, for each scalar field
sample up to 200 distinct non-missing values and assign an `AMBIGUOUS` resolver to
the field when it matches at least 90% of the sample.

Only `AMBIGUOUS` resolvers are promotable. Promoting a `NAME_GATED` one would
undo its gate — a column of `nnnn-nnnx` values in a field called `code` would
become ISSN links — so those stay gated on the field name, always.

```js
state.linkPlan = {};   // scalarField -> resolverId | null
```

This buys three things:

- **Column consistency.** A DOI column links on every row, instead of linking on
  the 97 rows that happen to be well formed and looking broken on the other 3.
- **Safety for `AMBIGUOUS` resolvers.** A one-off value that coincidentally looks
  like an OpenAlex ID in a column of gene names never links, because the column
  as a whole does not match.
- **Speed.** Rendering tests one candidate resolver per cell, not the whole table.

Individual values are still pattern-checked at render time, so a stray non-DOI
value inside a DOI column renders plain.

Nested (non-scalar) fields are not analyzed, so their leaves get `SELF_ID` and
`NAME_GATED` matching only — both are per-value decisions that need no plan.

The plan is rebuilt in `analyze()`, which already runs on load and on every
**Main record array** change, so it never goes stale.

## Resolver Registry

One table near the top of the script, each entry `{id, label, tier, fields, re, url}`.

### Self-identifying

| Resolver | Value pattern (anchored) | Target |
|---|---|---|
| DOI | `(?:doi:)?10\.\d{4,9}/[^\s"]+` | `https://doi.org/<doi>` |
| ORCID | `(\d{4}-){3}\d{3}[\dX]` | `https://orcid.org/<id>` |
| arXiv (prefixed) | `arxiv:(\d{4}\.\d{4,5}(v\d+)?\|[a-z-]+(\.[A-Z]{2})?/\d{7})` | `https://arxiv.org/abs/<id>` |
| PMCID | `PMC\d{5,9}` | `https://www.ncbi.nlm.nih.gov/pmc/articles/<id>/` |
| RePEc (EDIRC) | `RePEc:edi:([a-z0-9]+)` | `https://edirc.repec.org/data/<code>.html` |
| Handle | `hdl:(\S+)` or `\d{2,5}\.\d+/\S+` with `hdl` gate | `https://hdl.handle.net/<hdl>` |

Legacy DOIs contain `<`, `>`, `;`, and parentheses (the old Wiley/AIP style), so
the suffix class excludes only whitespace and `"`. Output safety comes from
`esc()` on both the href and the text, plus per-segment `encodeURIComponent`.

`RePEc:edi:` is verified against the bundled dataset, whose own `repec_url` field
gives `RePEc:edi:deharus` → `https://edirc.repec.org/data/deharus.html`. Other
RePEc handle namespaces (`:per:`, paper series) resolve differently; leave them
out until each target is confirmed rather than guessing a resolver.

### Field-name gated

| Resolver | Field gate (normalized, substring) | Value pattern | Target |
|---|---|---|---|
| PubMed | `pmid`, `pubmed` | `\d{4,9}` | `https://pubmed.ncbi.nlm.nih.gov/<id>/` |
| ISSN | `issn` | `\d{4}-?\d{3}[\dX]` | `https://portal.issn.org/resource/ISSN/<nnnn-nnnx>` |
| ISBN | `isbn` | 10 or 13 digits with optional hyphens | `https://openlibrary.org/isbn/<digits>` |
| Wikidata | `wikidata`, `qid` | `Q\d+` | `https://www.wikidata.org/wiki/<id>` |
| arXiv (bare) | `arxiv` | `\d{4}\.\d{4,5}(v\d+)?` | `https://arxiv.org/abs/<id>` |
| SSRN | `ssrn` | `\d{4,9}` | `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=<id>` |
| Semantic Scholar | `s2`, `semanticscholar`, `corpusid` | 40 hex, or digits | `https://www.semanticscholar.org/paper/<sha>` / `https://api.semanticscholar.org/CorpusID:<n>` |
| GitHub | `github`, `repo` | `[\w.-]+/[\w.-]+` | `https://github.com/<owner>/<repo>` |
| Email | `email`, `mail`, `contact` | `[^@\s]+@[^@\s]+\.\w{2,}` | `mailto:<addr>` |
| Bare host | `url`, `link`, `homepage`, `website`, `site`, `page` | `(www\.)?[\w-]+(\.[\w-]+)+(/\S*)?` | `https://<value>` |
| VIAF | `viaf` | `\d{5,22}` | `https://viaf.org/viaf/<id>` |
| ISNI | `isni` | 16 digits, optional spaces/hyphens | `https://isni.org/isni/<digits>` |

### Ambiguous, plan-promoted

| Resolver | Value pattern | Target |
|---|---|---|
| OpenAlex | `[WASICPFT]\d{7,10}` | `https://openalex.org/<id>` |
| ROR | `0[0-9a-hj-km-np-tv-z]{6}\d{2}` | `https://ror.org/<id>` |

Both also match via a field-name gate (`openalex`, `ror`), which is the common
case in practice since OpenAlex dumps usually carry full `https://openalex.org/…`
URLs already handled by tier 1.

### Considered and rejected

- **ISO country codes** (`country_code: "us"` in the bundled dataset) — no single
  canonical target; a Wikipedia guess would be a fabricated link.
- **Tickers, PERMNO, internal keys** — no public resolver, or resolver depends on
  a subscription.
- **Scopus / Web of Science IDs** — targets are behind authentication.
- **Bare 13-digit numbers as ISBN, bare digits as PMID** — only with a field-name
  gate, never on the value alone.

## Rendering Changes

`renderValue` needs the field name. Change its signature to
`renderValue(v, key)` and thread `key` through every call site:

| Call site | Change |
|---|---|
| `renderMeta` (`:269`) | `renderValue(v, k)` |
| card key/value rows (`:509`) | `renderValue(v, k)` |
| nested object entries (`:471`) | `renderValue(val, k)` — the child key, which is the correct gate for a leaf |
| arrays (`:467-468`) | pass the parent `key` down; array elements are the same kind of thing as the field |
| `renderObjLine` (`:477`) | take `key`, route leaf values through a shared inline formatter so object lines can link too |
| nested-field expander (`:534`) | `renderValue(r[field], field)` |

Scalar-string handling inside `renderValue` becomes:

```js
const s = String(v);
if(/^https?:\/\//i.test(s)) return link(s, s, null);          // unchanged
const hit = state.autoLink ? resolve(s, key) : null;          // registry lookup
return hit ? link(hit.url, s, hit.label) : esc(s);
```

`resolve(value, key)` trims the value, rejects anything longer than 300
characters, then tries `SELF_ID`, then `NAME_GATED` for the normalized key, then
the field's `state.linkPlan` entry.

`link(href, text, resolverLabel)` emits:

```html
<a class="vlink" href="…" target="_blank" rel="noopener noreferrer"
   title="DOI → https://doi.org/10.1257/aer.20190623">10.1257/aer.20190623</a>
```

Arrays of scalar identifiers keep their chip styling and become clickable chips
(`.chip a.vlink`), which is exactly what a list of DOIs or ORCIDs wants.

### Long literal URLs

A URL that was in the data and is longer than `URL_TEXT_MAX` (20) characters is
replaced by a label saying what following it does, with the full address kept in
both the `href` and the `title`:

| URL | Label |
|---|---|
| `.pdf` | `download pdf` |
| another file extension (`FILE_EXT`: archives, office and data formats, media, installers) | `download` |
| no file extension | `open <field>` |

Raw addresses otherwise dominate a card — the bundled dataset carries three per
record — and unlike an identifier the address itself is rarely the thing being
read. The extension is the only signal available without fetching the URL, so it
is matched against the path only, ignoring `?query` and `#fragment`; `…/pdf/browse`
is a page, `…/paper.pdf#page=3` is a download.

This applies only to the verbatim-URL branch. Auto-linked identifiers always show
their value however long, because the value *is* the information; a DOI collapsed
to a label would destroy the point of the field.

### Visual treatment

Every link the viewer renders looks the same, whether it resolved an identifier or
came verbatim from the data:

```css
a.vlink{border-bottom:1px dotted currentColor}
a.vlink:hover{text-decoration:none;border-bottom-style:solid}
```

The dotted underline plus the accent color is enough to read as a link; no glyph
is appended. The `title` attribute states the resolver and the full target, which
doubles as the debugging tool when a link looks wrong — and is the one place the
two kinds still differ.

### Card title and subtitle

The title (`:504`) and subtitle (`:505`) are escaped directly, not routed through
`renderValue`. When the title field resolves, link the heading text itself but
keep the heading's own color (`.card h3 a.vlink{color:inherit}`), so a page of
cards does not turn into a wall of blue. The subtitle stays plain.

### Filter panels stay plain

Value lists in the sidebar remain plain text. Each row is a checkbox label; a
link inside it would compete with the click target that selects the value.

## UI Additions

One entry in the existing **Display** block:

```html
<label>Auto-link IDs
  <select id="autoLink"><option value="1">on</option><option value="0">off</option></select>
</label>
```

State: `autoLink: true`. Changing it calls `renderCards(); renderMeta(); syncURL();`.

The **Metadata & dataset info** panel gains one row listing what was detected:

```text
linked ID fields   doi (DOI), orcid (ORCID), repec_id (RePEc/EDIRC)
```

This is the discoverability and diagnosis surface: if a column is not linking, or
is linking as the wrong scheme, the metadata row says so immediately.

## URL Behavior

One new parameter, emitted only when the feature is turned off, keeping default
URLs unchanged:

| Parameter | Meaning |
|---|---|
| `links=0` | Auto-linking disabled (omitted when on, the default) |

Handled symmetrically in `syncURL` and `restoreFromParams` alongside `view` and
`ps`.

## Security

- Targets are built from fixed `https://` literal prefixes plus a captured
  identifier passed through `encodeURIComponent` (per path segment), so a
  `javascript:` or `data:` target cannot be constructed from data.
- The final attribute is `esc()`d as everywhere else in the file.
- `rel="noopener noreferrer"` on every generated link, so a target page gets
  neither a window handle nor the referrer (which would leak the local viewer
  path or the dataset URL).
- All regexes are anchored with no nested quantifiers, and values over 300
  characters are skipped, so a hostile dataset cannot trigger pathological
  backtracking.
- The `mailto:` resolver only fires on a field-name gate, so ordinary text is
  never turned into a mail link.

## Performance

- Plan construction: one extra pass over at most 200 distinct values per scalar
  field, inside the existing `analyze()`. Negligible next to the record scan
  already there.
- Rendering: one or two regex tests per rendered cell (the field's planned
  resolver, plus the `SELF_ID` sweep for nested leaves), instead of the full
  registry. Compile every pattern once at module level; never build a `RegExp`
  inside `renderValue`.
- Card markup grows by roughly 100 bytes per linked cell. Relevant only with
  *Records per page = all* on a large dataset, which is already the slow path.

## Code Areas To Change

All in `json/json-browser.html`:

- **New:** `LINKERS` registry, `normKey`, `resolve`, `link`, `buildLinkPlan`.
- `state`: add `autoLink: true`, `linkPlan: {}`.
- `analyze()` (`:208`): call `buildLinkPlan()` after the value maps are filled.
- `renderValue` (`:463`): new `key` parameter, registry lookup for scalar strings.
- `renderObjLine` (`:477`): new `key` parameter, shared inline formatter.
- `renderMeta` (`:260`), `renderCards` (`:498`), `#cards` toggle handler (`:530`):
  pass field names into `renderValue`.
- `renderCards`: link the card title when its field resolves.
- Sidebar markup: the **Auto-link IDs** select; new `change` listener.
- `syncURL` (`:419`) / `restoreFromParams` (`:439`): the `links` parameter.
- CSS: `a.vlink` rules, shared with URLs that came from the data.

Documentation:

- `json/readme.md` — "How records render" (the value-formatting bullet at
  :198-199), the Display options table, the shareable-URL parameter table, and a
  short section listing the recognized identifier schemes and how to add one.

## Testing

Add `json/link-test.json`: one record per resolver, plus deliberate negatives in
the same file.

Negative cases that must render as plain text:

- `year: 1998`, `count: 12345678` — digits without a PMID/ISSN/SSRN field gate.
- `country_code: "us"` — no resolver.
- `note: "see 10.1257 for details"` — a DOI prefix without a suffix.
- `internal_id: "W12"` — too short for OpenAlex.
- `code: "0abcdefgh"` — ROR shape but wrong check-digit positions.
- A column of mostly free text with one accidental OpenAlex-looking value — must
  not link, because the field plan is not promoted.

Manual checklist: load by `?file=`, by URL, by picker, and by drag-and-drop;
switch **Main record array** and confirm the plan rebuilds; toggle **Auto-link
IDs** and confirm the URL gains and drops `links=0`; confirm filters, facet
counts, and global search are byte-identical with linking on and off; confirm
nested expanders and chip arrays link; confirm the metadata row lists the
detected fields.

## Risks And Tradeoffs

- **False positives.** The main risk, mitigated by the three-tier model, the 90%
  field-plan threshold, the dotted-underline marker, the `title` tooltip, and the off
  switch. Any resolver whose target is uncertain stays out of the registry.
- **Resolver drift.** Canonical URL forms change occasionally (PMC has already
  moved once). Confining every target to one table makes a fix a one-line edit.
- **Field-name heuristics are English- and convention-bound.** A `dokumentid`
  column will not be gated. Acceptable: the fallback is today's behavior.
- **Whole-column consistency versus per-value accuracy.** The 90% threshold
  deliberately suppresses links in mixed columns. A dataset with 80% DOIs will
  not link at all; the dataset-declared templates below are the escape hatch.
- **Scope creep toward a link database.** Keep the registry to identifiers with a
  single, free, canonical resolver.

## Suggested Implementation Order

1. Add the registry, `normKey`, `resolve`, and `link` with `SELF_ID` resolvers
   only. Thread `key` through `renderValue` and its call sites.
2. Add the CSS and confirm DOI/ORCID/arXiv/RePEc link on the bundled dataset.
3. Add `NAME_GATED` resolvers.
4. Add `buildLinkPlan` in `analyze()` and the `AMBIGUOUS` tier.
5. Add the **Auto-link IDs** control, the `links` URL parameter, and the metadata
   row.
6. Link the card title when its field resolves.
7. Add `link-test.json` and work the manual checklist.
8. Update `json/readme.md`.

## Future Extensions

- **Dataset-declared templates.** Honor a top-level metadata key so a file can
  declare its own resolvers with no code change:

  ```json
  { "_link_templates": { "internal_id": "https://intranet.example.org/rec/{}" } }
  ```

  `{}` is replaced by the encoded value. This handles private identifiers and
  mixed columns that the 90% threshold suppresses, and composes cleanly with the
  registry (declared templates win). The strongest candidate for version 2.
- Per-resolver toggles in the sidebar, if a dataset needs one scheme suppressed.
- Copy-to-clipboard affordance next to identifiers.
- A configurable `URL_TEXT_MAX`, or an elided `host/…/tail` form, if the flat
  `download` / `open <field>` label turns out to hide something worth seeing at a
  glance.
