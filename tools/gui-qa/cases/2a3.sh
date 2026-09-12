#!/bin/zsh
# 2A.3: opening .rb auto-checks, status shows issues.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
open_file "$STAND/gui-undoc.rb"
assert_ocr_retry "2a3" "issues found" 3 || { rmstand; return 1; }
rmstand
return 0
