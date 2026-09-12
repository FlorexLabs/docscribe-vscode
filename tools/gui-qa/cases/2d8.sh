#!/bin/zsh
# 2D.8: quitting VSCode stops the daemon (deactivate -> stopServer). Relaunched after.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
open_file "$STAND/clean.rb"
palette_run "DocScribe: Check current file"
pgrep -f "docscribe server \(" >/dev/null || { echo "daemon not running" >&2; return 1; }
save_all
osascript -e 'tell application "Visual Studio Code" to quit'
for (( i = 0; i < 15; i++ )); do
  pgrep -f "docscribe server \(" >/dev/null || break
  sleep 1
done
pgrep -f "docscribe server \(" >/dev/null && { echo "daemon survived quit" >&2; return 1; }
if pgrep -f "/Applications/Visual Studio Code.app" >/dev/null; then
  shot "2d8-blocker"
  echo "VSCode still alive (blocker shot saved)" >&2
  return 1
fi
nohup open -a "Visual Studio Code" --args "$STAND" >/dev/null 2>&1 </dev/null &
sleep 8
shot "2d8"
ocr_text | grep -qi "qa-stand" || return 1
return 0
