#!/bin/zsh
# 2A.6: clean file -> status OK.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
open_file "$STAND/clean.rb"
assert_ocr_retry "2a6" "DocScribe: OK" 3 || return 1
return 0
