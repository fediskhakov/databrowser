#!/bin/bash
# serve-json.sh — serve json-browser.html with a given JSON file via a local
# Python HTTP server and open it in the browser.
#
#   Usage: ./serve-json.sh <data.json> [port] [key=value ...]
#
# A bare-integer extra argument sets the port (default 8753); every other extra
# argument is appended to the page URL as a query parameter, so you can open the
# viewer with a preset view — search, paging, view mode, filters, etc. e.g.:
#
#   ./serve-json.sh data.json q=harvard ps=all f.status=verified f.status=student
#
# opens  ...?file=data.json&q=harvard&ps=all&f.status=verified&f.status=student
# (see the readme's "Shareable URLs" table for the recognized parameters).
#
# The JSON may live anywhere on disk: the script serves an isolated temp
# directory containing symlinks to the viewer and the JSON, so http.server can
# reach the file with a clean ?file= path. Ctrl-C stops the server and cleans up.
#
# Portable bash (works with macOS's /bin/bash 3.2 and any newer bash).
#
# recommended alias for quick access (add to .zshrc or .bashrc):
# alias json="<your path to the cloned repo>/json/serve-json.sh"

set -e

SELF_DIR=$(cd -- "$(dirname -- "$0")" && pwd) # directory this script lives in
VIEWER="$SELF_DIR/json-browser.html"
PORT=8753

if [[ -z "$1" ]]; then
  printf '%s\n' "Usage: $0 <data.json> [port] [key=value ...]" >&2
  exit 1
fi
if [[ ! -f "$VIEWER" ]]; then
  printf '%s\n' "error: json-browser.html not found next to this script ($VIEWER)" >&2
  exit 1
fi

# absolute path to the JSON file (no shell-specific path modifiers)
case "$1" in
  /*) JSON="$1" ;;
  *)  JSON="$PWD/$1" ;;
esac
if [[ ! -f "$JSON" ]]; then
  printf '%s\n' "error: file not found: $1" >&2
  exit 1
fi

# Args after <data.json>: a bare integer sets the port; every other one is a
# key=value pair appended to the page URL's query string (preset view state).
EXTRA_PARAMS=()
for arg in "${@:2}"; do
  if [[ "$arg" =~ ^[0-9]+$ ]]; then
    PORT=$arg
  else
    EXTRA_PARAMS+=("$arg")
  fi
done

PY=$(command -v python3 || command -v python) || { printf '%s\n' "error: python3 not found" >&2; exit 1; }

# quick JSON validity check (warn only — still serve)
if ! "$PY" -c "import json,sys; json.load(open(sys.argv[1]))" "$JSON" 2>/dev/null; then
  printf '%s\n' "warning: $1 does not parse as JSON — serving anyway" >&2
fi

# isolated serve dir: symlink the viewer + the JSON into it
SERVE_DIR=$(mktemp -d) || { printf '%s\n' "error: could not create temp dir" >&2; exit 1; }
BASENAME=$(basename -- "$JSON")
ln -s "$VIEWER" "$SERVE_DIR/json-browser.html"
ln -s "$VIEWER" "$SERVE_DIR/index.html"
ln -s "$JSON"   "$SERVE_DIR/$BASENAME"

SRV_PID=""
cleanup() { [[ -n "$SRV_PID" ]] && kill "$SRV_PID" 2>/dev/null; rm -rf "$SERVE_DIR"; }
trap 'cleanup; exit 130' INT TERM
trap cleanup EXIT

# start the server (Python 3.7+: --directory)
"$PY" -m http.server "$PORT" --bind 127.0.0.1 --directory "$SERVE_DIR" >/dev/null 2>&1 &
SRV_PID=$!
sleep 1

if ! kill -0 "$SRV_PID" 2>/dev/null; then
  printf '%s\n' "error: server failed to start on port $PORT (already in use?)." >&2
  printf '%s\n' "       try another port:  $0 \"$1\" <port>" >&2
  exit 1
fi

# Query string: file=<basename> plus any extra key=value params, URL-encoded.
# An extra arg without '=' becomes a bare key (empty value).
QS=$("$PY" -c '
import urllib.parse, sys
pairs = [("file", sys.argv[1])]
for a in sys.argv[2:]:
    k, _, v = a.partition("=")
    pairs.append((k, v))
print(urllib.parse.urlencode(pairs))
' "$BASENAME" "${EXTRA_PARAMS[@]}")
URL="http://127.0.0.1:$PORT/json-browser.html?$QS"

printf '%s\n' "Serving: $1"
printf '%s\n' "URL:     $URL"
printf '%s\n' "Press Ctrl-C to stop."

# open the default browser (macOS: open, Linux: xdg-open)
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
fi

wait "$SRV_PID"
