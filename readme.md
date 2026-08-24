# Data Table Browsers

A collection of self-contained, dependency-free web interfaces for browsing and
visualizing data tables. Each tool is a single HTML file that runs entirely in the
browser — no build step, no backend, and no network calls beyond fetching the data
file you point it at.

## Available

- **[JSON browser](json/readme.md)** (`json/json-browser.html`) — point it at any
  JSON file and it discovers the record array and fields, then builds the interface
  around them: faceted filters that stay honest as you narrow, multi-level sorting,
  global search, and combining whole sets of filters with OR. It reads the data's
  shape too — identifiers (DOI, ORCID, OpenAlex, ROR, arXiv, RePEc, …) become links
  to their resolver, image URLs become thumbnails, long text becomes expandable
  sections. Tick the records you want and copy them out — a short text version
  carrying the fields you chose, or the full cards as HTML that pastes into an email
  looking like the page. Write a note against any record — copying the noted records out
  as text, or downloading the whole file back as JSON with the notes written into
  it; a file that already keeps notes opens straight into editing them. Every view is a shareable URL, and it works on a phone.
  The bundled [`serve-json.sh`](json/serve-json.sh) helper serves the viewer with
  any JSON file (located anywhere on disk) and opens it in one command; you can also
  open the HTML directly via `file://`. See the
  [JSON browser readme](json/readme.md) for full details.

## Plans for future development

- Google Sheets browser

## License

MIT — see [LICENSE](LICENSE).

*Developed with Claude*
