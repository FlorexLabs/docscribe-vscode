#!/bin/zsh
# 2B.3: workspace check summary is correct (cancel path: code-fixed, manual).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
open_file "$STAND/gui-undoc.rb"
log=$(docscribe_log)
palette_run "DocScribe: Check entire workspace"
rmstand
tail -c 3000 "$log" | grep -q "offense_count" || { echo "no summary in log" >&2; return 1; }
return 0
