#!/bin/zsh
# 2D.7: kill -9 the daemon; next check must recover fast (no 30s hang).
# Oracle: status flips issues->OK, which only a real post-kill run can produce.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
open_file "$STAND/gui-undoc.rb"
palette_run "DocScribe: Check current file"
assert_ocr_retry "2d7-issues" "issues found" 2 || { rmstand; return 1; }
setopt nullglob
sock=$(ls -t /tmp/docscribe-*.sock "$TMPDIR"/docscribe-*.sock 2>/dev/null | head -n 1)
unsetopt nullglob
[[ -n "$sock" && -f "$sock.pid" ]] || { echo "no daemon socket/pid" >&2; rmstand; return 1; }
kill -9 "$(cat "$sock.pid")"
sleep 1
open_file "$STAND/clean.rb"
start=$(date +%s)
palette "DocScribe: Check current file"
osascript -e 'tell application "System Events" to key code 36'
assert_ocr_retry "2d7-ok" "DocScribe: OK" 5 || { rmstand; return 1; }
elapsed=$(( $(date +%s) - start ))
rmstand
[[ $elapsed -le 25 ]] || { echo "recovery too slow: ${elapsed}s" >&2; return 1; }
echo "# recovered in ${elapsed}s"
return 0
