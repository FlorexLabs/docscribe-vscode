#!/bin/zsh
# 2B.4: safe fix documents methods, descriptions n/a, log updated.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
open_file "$STAND/gui-undoc.rb"
log=$(docscribe_log)
palette_run "DocScribe: Apply safe fixes to current file"
grep -c "@return" "$STAND/gui-undoc.rb" | grep -q "[2-9]" || { echo "methods not documented" >&2; rmstand; return 1; }
tail -c 2000 "$log" | grep -q "updated 1 file" || { echo "no updated-1-file in log" >&2; rmstand; return 1; }
# NOTE: trailing-WS check lives in framework tests (card 498); release build still emits it.
save_all
rmstand
return 0
