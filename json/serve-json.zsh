#!/usr/bin/env zsh
# serve-json.zsh — serve json-browser.html with a given JSON file via a local
# Python HTTP server and open it in the browser.
#
#   Usage: ./serve-json.zsh <data.json> [port]
#
# The JSON may live anywhere on disk: the script serves an isolated temp
# directory containing symlinks to the viewer and the JSON, so http.server can
# reach the file with a clean ?file= path. Ctrl-C stops the server and cleans up.

emulate -L zsh
set -e

SELF_DIR=${0:A:h}                       # directory this script lives in
VIEWER="$SELF_DIR/json-browser.html"
PORT=${2:-8753}

if [[ -z "$1" ]]; then
  print -u2 "Usage: $0 <data.json> [port]"
  exit 1
fi
if [[ ! -f "$VIEWER" ]]; then
  print -u2 "error: json-browser.html not found next to this script ($VIEWER)"
  exit 1
fi

JSON=${1:A}                             # absolute path to the JSON file
if [[ ! -f "$JSON" ]]; then
  print -u2 "error: file not found: $1"
  exit 1
fi

PY=$(command -v python3 || command -v python) || { print -u2 "error: python3 not found"; exit 1; }

# quick JSON validity check (warn only — still serve)
if ! "$PY" -c "import json,sys; json.load(open(sys.argv[1]))" "$JSON" 2>/dev/null; then
  print -u2 "warning: $1 does not parse as JSON — serving anyway"
fi

# isolated serve dir: symlink the viewer + the JSON into it
SERVE_DIR=$(mktemp -d) || { print -u2 "error: could not create temp dir"; exit 1; }
BASENAME=${JSON:t}
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
  print -u2 "error: server failed to start on port $PORT (already in use?)."
  print -u2 "       try another port:  $0 \"$1\" <port>"
  exit 1
fi

ENC=$("$PY" -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$BASENAME")
URL="http://127.0.0.1:$PORT/json-browser.html?file=$ENC"

print "Serving: $1"
print "URL:     $URL"
print "Press Ctrl-C to stop."

# open the default browser (macOS: open, Linux: xdg-open)
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
fi

wait "$SRV_PID"
