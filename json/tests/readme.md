# Tests for json-browser.html

```sh
./run.sh                 # everything
./run.sh links url       # only suites whose name contains "links" or "url"
PORT=9000 ./run.sh       # serve on a specific port
CHROME=/path/to/chrome ./run.sh
```

Needs **node 18+** (for the built-in `fetch` and `WebSocket` — no `npm install`,
no dependencies) and **python3** for the throwaway static server. The page suites
also need Chrome or Chromium; without one they are skipped and the unit suites
still run.

## How they work

The viewer is a single HTML file with no build step and no module system, so
there is nothing to `import`. The suites work around that in two ways.

**Unit suites** lift a run of source straight out of `json-browser.html` with
`lib.js`'s `slice(firstLine, lastLine)`, prepend stubs for the few globals that
run of code touches (`state`, `bare`, `normKey` …), and evaluate the result in
Node. They test the shipped code itself, so a change to the page is picked up
immediately — but if you rename a function or reword the line a slice is anchored
to, the slice throws with the marker it could not find. Re-anchor it; do not copy
the function into the test.

**Page suites** launch headless Chrome against a static server on `127.0.0.1`
and drive the real page over the DevTools Protocol, asserting on rendered DOM and
`location.search`. They catch what unit tests structurally cannot: CSS
specificity, event delegation, layout at a given viewport.

## The suites

| suite | kind | covers |
|---|---|---|
| `test-links` | unit | identifier detection (DOI, ORCID, arXiv, RePEc …), the three tiers, URL label collapsing |
| `test-images` | unit | image-field detection, which fields are offered vs auto-chosen |
| `test-sort` | unit | comparators: multi-level cascade, last-word ordering, missing values |
| `test-text` | unit | long-text detection by 90th-percentile-by-record |
| `test-url` | unit | the URL writer and reader round-tripping, packing, old spellings |
| `test-numsort` | unit | numeric-column detection and facet value ordering |
| `test-interaction` | page | the bulk of the UI: filters, facets, OR sets, sorting, paging, mobile layout |
| `test-messy` | page | hostile JSON — `messy-test.json`: a primitive among the records, a `__proto__` field name, an empty field name, mixed arrays |
| `test-ortip` | page | the OR button's help tooltip stays reachable while the button is disabled |
| `test-numfacet` | page | numeric facet ordering as it reaches the screen, including under a live filter |
| `test-select` | page | the select boxes and the two copy buttons: where the box lands, double-click taking the page, the bar appearing, selection surviving filter/sort/page, copies following the page's sort even for records the filters hide, both copy formats, and the short-copy field row (heading included) round-tripping through `h2` |
| `test-describe` | page | the filter pane's **⧉** button: the description's three shapes (nothing set, panels only, saved OR sets), that a suspended filter is never described, and that the clipboard gets exactly what was described |

Fixtures live one level up beside the viewer, so the same server serves both:
`link-test.json`, `image-test.json`, `sort-test.json`, `text-test.json`,
`messy-test.json`, `copy-test.json`, and the real `econ_departments.json`.

## Two traps worth knowing

**Synthetic events must bubble.** The page uses delegated listeners on
containers. `el.dispatchEvent(new Event("change"))` does not bubble by default,
so the handler never fires and assertions fail in a way that looks like broken
application code. Real user events bubble; pass `{bubbles: true}`.

**Headless Chrome's default window is 800px wide**, which is below the 820px
breakpoint where the sidebar folds away — so filter panels are not in the DOM and
every sidebar assertion fails. Page suites set a wider window explicitly; keep
doing so, or set it via `Emulation.setDeviceMetricsOverride`.

**The clipboard needs a user gesture.** `navigator.clipboard.write` and
`document.execCommand("copy")` both refuse without transient user activation, which
a bare `Runtime.evaluate` does not carry — pass `userGesture: true` for the click
that copies, and grant `clipboardReadWrite` with `Browser.grantPermissions`.
Otherwise the copy silently fails and the button reports it, which reads like a
broken feature rather than a missing test flag.
