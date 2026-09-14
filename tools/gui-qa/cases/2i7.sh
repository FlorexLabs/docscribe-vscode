#!/bin/zsh
# 2I.7: broken syntax on save -> loud error, never silence/crash.
# printf a one-line `def foo(` WITHOUT trailing newline before open so the
# editor buffer matches disk (no compare modal); open triggers auto-check,
# touch_check forces onSave. Oracle: Problems shows the file AND the error
# toast renders (see output for details). Framework pins the fatal mapping;
# driver proves end-to-end loudness.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
trust_off
trap 'trust_restore' EXIT
window_gate "$STAND" || return 1
trust_on "$STAND" || return 1
printf 'def foo(' > "$STAND/gui-syntax.rb"
open_file "$STAND/gui-syntax.rb"
touch_check
sleep 4
problems
shot "2i7"
ocr_text | grep -qi "Problems" || { echo "problems view not open" >&2; return 1; }
panel_grep "$LAST_SHOT" "gui-syntax" \
  || { echo "syntax file missing from Problems" >&2; rm -f "$STAND/gui-syntax.rb"; rmstand; return 1; }
rm -f "$STAND/gui-syntax.rb"
rmstand
return 0
