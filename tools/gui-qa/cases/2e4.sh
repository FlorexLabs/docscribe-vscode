#!/bin/zsh
# 2E.4: missing-rbs balloon. Shows text+button on a no-rbs project; the
# button appends `gem "rbs"` (+ toast); silent once rbs is present and when
# useRbs=false; unreadable Gemfile surfaces the gem gate, no crash.
# Once-per-session flag itself is framework-covered (resetRbsBalloon tests).
#
# Trust stays OFF for the whole case (trap-restored at the end): restoring
# mid-case puts later Reloads into Restricted Mode with extensions dead
# (proven 2026-09-13). Activation needs an open ruby file: workspaceContains
# alone proved flaky (idle window, zero balloons).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
NORBS_STAND="${NORBS_STAND:-/tmp/norbs-stand}"
SET="$HOME/Library/Application Support/Code/User/settings.json"

mk_norbs_stand || return 1
trust_off
trap 'trust_restore' EXIT
window_gate "$NORBS_STAND" || return 1
trust_on "$NORBS_STAND" || return 1
# (front_window superseded by window_gate above)
open_file "$NORBS_STAND/probe.rb"
palette_run "Reload Window"

# 1. balloon with text + button (gem check takes a while after reload;
# cold-window activation is slow — retry wide).
found=0
for i in 1 2 3 4 5 6 7 8; do
  activate
  shot "2e4-balloon-$i"
  txt=$(ocr_text)
  if echo "$txt" | grep -qi "RBS type inference is enabled" \
    && echo "$txt" | grep -qi "Add rbs to Gemfile"; then
    found=1; break
  fi
  sleep 4
done
[[ $found -eq 1 ]] || { echo "balloon not shown" >&2; return 1; }

# 2. click the button -> gem appended + toast (toast persists; retry click).
clicked=0
for i in 1 2 3; do
  shot "2e4-click-$i"
  click_text "$LAST_SHOT" "Add rbs to Gemfile"
  sleep 2
  grep -q 'gem "rbs"' "$NORBS_STAND/Gemfile" && { clicked=1; break; }
  sleep 2
done
[[ $clicked -eq 1 ]] || { echo "Add button did not append gem" >&2; return 1; }
shot "2e4-added"
# Toast tail gets clipped by OCR ("Run 'bun..."), assert the stable head.
ocr_text | grep -qi "added to Gemfile" || { echo "no gem-added toast" >&2; return 1; }
escape

# 3. rbs present now -> reload -> silent (window-title sanity + retries:
# cold reload is slow, single-shot sanity flakes).
palette_run "Reload Window"
sane=0
for i in 1 2 3; do
  sleep 6
  activate
  shot "2e4-silent-$i"
  ocr_text | grep -qi "norbs-stand" && { sane=1; break; }
done
[[ $sane -eq 1 ]] || { echo "screen not ready" >&2; return 1; }
txt=$(ocr_text)
echo "$txt" | grep -qi "RBS type inference is enabled" \
  && { echo "balloon reshown after add" >&2; return 1; }

# 4. useRbs:false -> silent even without rbs (surgical restore keeps trust off).
cp "$NORBS_STAND/Gemfile.norbs" "$NORBS_STAND/Gemfile"
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.useRbs']=False; json.dump(d, open(p,'w'))"
palette_run "Reload Window"
sane=0
for i in 1 2 3; do
  sleep 6
  activate
  shot "2e4-off-$i"
  ocr_text | grep -qi "norbs-stand" && { sane=1; break; }
done
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.useRbs']=True; json.dump(d, open(p,'w'))"
[[ $sane -eq 1 ]] || { echo "screen not ready" >&2; return 1; }
txt=$(ocr_text)
echo "$txt" | grep -qi "RBS type inference is enabled" \
  && { echo "balloon shown with useRbs:false" >&2; return 1; }

# 5. unreadable Gemfile -> the gem gate fires first (bundle fails), so the GUI
# shows the gem balloon, never the rbs one; nothing crashes. The
# cannot-read/write toasts are TOCTOU-only via GUI and are framework-covered.
chmod 000 "$NORBS_STAND/Gemfile"
palette_run "Reload Window"
found=0
for i in 1 2 3 4 5 6 7 8; do
  activate
  shot "2e4-unread-$i"
  ocr_text | grep -qi "gem .docscribe. not found" && { found=1; break; }
  sleep 4
done
chmod 644 "$NORBS_STAND/Gemfile"
escape
[[ $found -eq 1 ]] || { echo "no gem-gate balloon on unreadable Gemfile" >&2; return 1; }
return 0
