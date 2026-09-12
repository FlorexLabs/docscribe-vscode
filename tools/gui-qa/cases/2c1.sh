#!/bin/zsh
# 2C.1: Problems view lists the missing-docs entry.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
open_file "$STAND/gui-undoc.rb"
palette_run "DocScribe: Check current file"
problems
rmstand
assert_ocr_retry "2c1" "Missing YARD" 2 || return 1
return 0
