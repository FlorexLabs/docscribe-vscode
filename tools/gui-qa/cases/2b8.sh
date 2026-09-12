#!/bin/zsh
# 2B.8: context menu has 4 DocScribe entries; palette lists the commands.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
open_file "$STAND/calc.rb"
ctrl_g 15
shift_f10
shot "2b8-menu"
menu=$(ocr_text)
for want in "Check current file" "Apply safe fixes" "Apply aggressive fixes" "Update types from RBS"; do
  echo "$menu" | grep -qi "$want" || { echo "menu miss: $want" >&2; return 1; }
done
escape
palette "DocScribe"
shot "2b8-palette"
pal=$(ocr_text)
for want in "Check current file" "Check entire workspace" "Apply safe fixes" "Doctor" "Toggle fold" "Update types from RBS"; do
  echo "$pal" | grep -qi "$want" || { echo "palette miss: $want" >&2; return 1; }
done
escape
return 0
