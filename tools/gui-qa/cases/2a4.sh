#!/bin/zsh
# 2A.4: .rake file is treated as Ruby (a check runs; tasks.rake is offense-free -> OK).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
open_file "$STAND/tasks.rake"
assert_ocr_retry "2a4" "DocScribe: (OK|issues found)" 3 || return 1
return 0
