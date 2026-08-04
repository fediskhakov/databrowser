#!/bin/bash
# run.sh — run every test suite for json-browser.html.
#
#   ./run.sh              # everything
#   ./run.sh links url    # only suites whose name contains "links" or "url"
#   PORT=9000 ./run.sh    # serve on a specific port
#   CHROME=/path/to/chrome ./run.sh
#
# Needs node (18+, for the built-in fetch and WebSocket) and python3. The page
# suites additionally need Chrome or Chromium; they are skipped with a notice if
# none is installed, so the unit suites still run.
#
# Unit suites slice functions straight out of json-browser.html and run them in
# Node — no browser, no server. Page suites drive the real page in headless
# Chrome over the DevTools Protocol, against a throwaway server on 127.0.0.1.
#
# Portable bash (works with macOS's /bin/bash 3.2 and any newer bash).

SELF_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SERVE_DIR=$(cd -- "$SELF_DIR/.." && pwd)     # the json/ directory: viewer + fixtures

UNIT_SUITES="test-links test-images test-sort test-text test-url test-numsort"
PAGE_SUITES="test-interaction test-messy test-ortip test-numfacet test-select"

NODE=$(command -v node) || { printf '%s\n' "error: node not found" >&2; exit 2; }
PY=$(command -v python3 || command -v python) || { printf '%s\n' "error: python3 not found" >&2; exit 2; }

# Only run suites matching one of the arguments (substring match); no args = all.
selected() {
  local name=$1 pat; shift
  [ $# -eq 0 ] && return 0                 # no filter given: run everything
  for pat in "$@"; do case "$name" in *"$pat"*) return 0 ;; esac; done
  return 1
}

# Is a browser available? lib.js knows where to look; ask it rather than duplicating.
HAVE_CHROME=1
"$NODE" -e 'require("'"$SELF_DIR"'/lib.js").chromeBin()' >/dev/null 2>&1 || HAVE_CHROME=0

PORT=${PORT:-8797}
SRV_PID=""
cleanup() { [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null; }
trap 'cleanup; exit 130' INT TERM
trap cleanup EXIT

start_server() {
  local tries=0
  while [ $tries -lt 20 ]; do
    "$PY" -m http.server "$PORT" --bind 127.0.0.1 --directory "$SERVE_DIR" >/dev/null 2>&1 &
    SRV_PID=$!
    # wait for it to answer rather than guessing with a fixed sleep
    local n=0
    while [ $n -lt 50 ]; do
      if curl -sf -o /dev/null "http://127.0.0.1:$PORT/json-browser.html" 2>/dev/null; then return 0; fi
      kill -0 "$SRV_PID" 2>/dev/null || break      # died: port busy, try the next one
      n=$((n + 1)); sleep 0.1
    done
    kill "$SRV_PID" 2>/dev/null; SRV_PID=""
    PORT=$((PORT + 1)); tries=$((tries + 1))
  done
  printf '%s\n' "error: could not start a server on 127.0.0.1" >&2
  return 1
}

TOTAL_PASS=0; TOTAL_FAIL=0; RAN=0; FAILED_SUITES=""

run_suite() {
  local name=$1 out line p f code
  out=$("$NODE" "$SELF_DIR/$name.js" "$PORT" 2>&1); code=$?
  line=$(printf '%s\n' "$out" | grep -E '^[0-9]+ passed' | tail -1)
  RAN=$((RAN + 1))
  if [ -n "$line" ]; then
    p=${line%% passed*}; f=${line#*, }; f=${f%% failed*}
    TOTAL_PASS=$((TOTAL_PASS + p)); TOTAL_FAIL=$((TOTAL_FAIL + f))
    printf '  %-18s %s\n' "$name" "$line"
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    printf '  %-18s no summary — the suite crashed\n' "$name"
  fi
  if [ $code -ne 0 ]; then
    FAILED_SUITES="$FAILED_SUITES $name"
    printf '%s\n' "$out" | grep -E 'FAIL|Error|error:|WATCHDOG' | head -20 | sed 's/^/      /'
  fi
}

printf '\n%s\n' "unit suites (no browser)"
for s in $UNIT_SUITES; do selected "$s" "$@" && run_suite "$s"; done

if [ $HAVE_CHROME -eq 0 ]; then
  printf '\n%s\n' "page suites: SKIPPED — no Chrome or Chromium found (set \$CHROME to run them)"
else
  want_page=0
  for s in $PAGE_SUITES; do selected "$s" "$@" && want_page=1; done
  if [ $want_page -eq 1 ]; then
    start_server || exit 2
    printf '\n%s\n' "page suites (headless Chrome, server on port $PORT)"
    for s in $PAGE_SUITES; do selected "$s" "$@" && run_suite "$s"; done
  fi
fi

printf '\n%s\n' "-----------------------------------------------"
if [ $RAN -eq 0 ]; then
  printf '%s\n\n' "no suite matched: $*"
  exit 1
fi
printf '%s\n\n' "$TOTAL_PASS passed, $TOTAL_FAIL failed, across $RAN suites"
[ -n "$FAILED_SUITES" ] && printf '%s\n\n' "failed:$FAILED_SUITES"
[ $TOTAL_FAIL -eq 0 ] || exit 1
exit 0
