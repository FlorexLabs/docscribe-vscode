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
problems
rm -f "$STAND/gui-broken.rb"
rmstand
shot "2c8"
ocr_text | grep -qiE "gui-broken|error|Error" || return 1
return 0
