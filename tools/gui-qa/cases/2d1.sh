#!/bin/zsh
# 2D.1: with server on, Doctor reports Backend: server.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

activate
palette_run "DocScribe: Doctor"
pageup 4
assert_ocr "2d1-top" "Server mode: Available" || return 1
pagedown 2
assert_ocr "2d1" "Backend: server" || return 1
return 0
