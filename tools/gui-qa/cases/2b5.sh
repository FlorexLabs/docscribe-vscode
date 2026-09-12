#!/bin/zsh
# 2B.5: aggressive fix keeps descriptions, rebuilds types.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
open_file "$STAND/gui-partial.rb"
palette_run "DocScribe: Apply aggressive fixes to current file"
grep -q "Old desc" "$STAND/gui-partial.rb" || { echo "description lost" >&2; rmstand; return 1; }
grep -q "@return" "$STAND/gui-partial.rb" || { echo "types not rebuilt" >&2; rmstand; return 1; }
rmstand
return 0
