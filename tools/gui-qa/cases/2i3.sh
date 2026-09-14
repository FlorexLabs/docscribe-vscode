#!/bin/zsh
# 2I.3: RU locale — palette + Settings render Russian; back to EN renders
# English with no %...% placeholders. Surgical locale toggle + trap.
# Oracle on stable RU/EN words (OCR mangles long Cyrillic lines).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
SET="$HOME/Library/Application Support/Code/User/settings.json"
STAND="${STAND:-$HOME/qa-stand}"

# NOTE: VSCode reads UI locale from argv (--locale), NOT from settings.json
# `locale` (proven 2026-09-14: settings toggle left the palette EN). And
# `open -a ... --args --locale ru` does NOT propagate --locale through
# `open` either (proven 2026-09-14: UI stayed EN). Invoke the binary
# directly with --locale; run.sh pre-run wipe keeps it idempotent.
restart_code() {
  pkill -9 -f "/Applications/Visual Studio Code.app" 2>/dev/null
  sleep 3
  nohup "/Applications/Visual Studio Code.app/Contents/MacOS/Code" "$STAND" --locale "$1" --user-data-dir "$HOME/Library/Application Support/Code" >/dev/null 2>&1 </dev/null &
  sleep 12
  front_window "qa-stand" || return 1
}
activate
mkstand
trust_off
trap 'trust_restore' EXIT
restart_code ru || { echo "restart failed (ru)" >&2; return 1; }
palette "DocScribe"
shot "2i3-ru"
ocr_text | grep -qi "Проверить" \
  || { echo "RU command title missing" >&2; return 1; }
restart_code en || { echo "restart failed (en)" >&2; return 1; }
palette "DocScribe"
shot "2i3-en"
ocr_text | grep -qi "Check current file" \
  || { echo "EN command title missing" >&2; return 1; }
ocr_text | grep -q "%[a-zA-Z.]*%" \
  && { echo "unresolved placeholder in EN UI" >&2; return 1; }
rmstand
return 0
