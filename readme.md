# Data Table Browsers

A collection of self-contained, dependency-free web interfaces for browsing and
visualizing data tables. Each tool is a single HTML file that runs entirely in the
browser — no build step, no backend, and no network calls beyond fetching the data
file you point it at.

## Available

- **[JSON browser](json/readme.md)** (`json/json-browser.html`) — dependency-free
  JSON viewer with auto-faceted filters, global search, and shareable-URL state. It
  auto-discovers the record array and fields and builds the filter UI on the fly.
  The bundled [`serve.sh`](json/serve.sh) helper serves the viewer with
  any JSON file (located anywhere on disk) and opens it in one command; you can also
  open the HTML directly via `file://`. See the
  [JSON browser readme](json/readme.md) for full details.

## Plans for future development

- Google Sheets browser

## License

MIT — see [LICENSE](LICENSE).

*Developed with Claude*
