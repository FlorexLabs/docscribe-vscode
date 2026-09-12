#!/bin/zsh
# 2B.2: check on .js warns, no check runs.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

toast_once() {
  palette "DocScribe: Check current file"
  osascript -e 'tell application "System Events" to key code 36'
  sleep 1
  shot "2b2"
  ocr_text | grep -qi "Open a Ruby or Rake file first"
}

activate
open_file "/tmp/qempty/note.txt"
log=$(docscribe_log)
before=$(log_mark "$log")
toast_once || toast_once || return 1
after=$(log_mark "$log")
[[ "$after" == "$before" ]] || { echo "check ran on .txt" >&2; return 1; }
return 0
