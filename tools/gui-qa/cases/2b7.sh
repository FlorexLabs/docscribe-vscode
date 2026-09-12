#!/bin/zsh
# 2B.7: Quick Fix on a clean line -> core "No code actions available", file untouched.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
open_file "$STAND/calc.rb"
ctrl_g 1
before=$(md5 -q "$STAND/calc.rb")
palette_run "Quick Fix..."
assert_ocr "2b7" "No code actions available" || return 1
escape
assert_md5_same "$STAND/calc.rb" "$before" || return 1
return 0
