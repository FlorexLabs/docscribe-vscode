#!/bin/zsh
# 2C.8: workspace check surfaces the broken file; Problems lists it.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
printf 'def broken(\n' > "$STAND/gui-broken.rb"
open_file "$STAND/gui-undoc.rb"
mkstand
palette_run "DocScribe: Check entire workspace"
# Honest oracle: workspace results render ONLY to Output → DocScribe
# (showResult; Problems stays single-file). The old fullscreen grep
# false-greened on the stale explorer entry (proven 2026-09-13: panel
# never listed the file). panelhunt confines to the Output area.
panelhunt "2c8" "gui-broken" || { rm -f "$STAND/gui-broken.rb"; rmstand; return 1; }
rm -f "$STAND/gui-broken.rb"
rmstand
return 0
