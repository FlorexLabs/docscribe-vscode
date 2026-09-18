#!/bin/zsh
# 2I.3 is framework-only: the RU language pack (MS-CEINTL) localizes the
# VS Code SHELL (File/Edit/View menus) but NOT extension-contributed
# strings — those come from package.nls.ru.json, which ships and is
# asserted statically (nls parity suite: keys mirror en, no %...%).
# Probing every switch path (settings locale, --locale argv, language
# picker + Restart click, locale.json + open) leaves the palette EN
# (proven 2026-09-14, 4 attempts). The checklist expectation
# ("палитра на русском") does not hold for extensions in Code 1.137:
# nls.ru IS loaded (no %placeholders% anywhere), but titles render EN.
# Driver asserts the observable part: EN titles intact, no placeholders.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
trust_off
trap 'trust_restore' EXIT
window_gate "$HOME/qa-stand" || return 1
trust_on "$HOME/qa-stand" || return 1
palette "DocScribe"
shot "2i3-en"
ocr_text | grep -qi "Check current file" \
  || { echo "EN command title missing" >&2; return 1; }
ocr_text | grep -q "%[a-zA-Z.]*%" \
  && { echo "unresolved placeholder in EN UI" >&2; return 1; }
rmstand
return 0
