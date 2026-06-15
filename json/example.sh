#!/bin/bash
# run from this script's own directory so the relative paths resolve anywhere
cd -- "$(dirname -- "$0")"

./serve-json.sh econ_departments.json title=university sub=country

# recommended alias for quick access (add to .zshrc or .bashrc):
# alias json="<your path to the cloned repo>/json/serve-json.sh"