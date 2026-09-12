#!/bin/zsh
# 2A.7: non-Ruby file -> silence (no check runs).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

activate
open_file "/tmp/qempty/note.txt"
log=$(docscribe_log)
before=$(log_mark "$log")
sleep 4
after=$(log_mark "$log")
[[ "$after" == "$before" ]] || { echo "unexpected check ran on .txt" >&2; return 1; }
return 0
