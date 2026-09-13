#!/bin/zsh
# 2E.5: validateTypes on -> InvalidType diagnostic in Problems; off -> quiet
# + Doctor "Validate types: off". Quickfix routing itself is
# framework-covered (diagnosticProvider/codeActionProvider suites; Ctrl+.
# never fires via osascript).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
VT_STAND="${VT_STAND:-/tmp/vt-stand}"
SET="$HOME/Library/Application Support/Code/User/settings.json"

mk_vt_stand || return 1
trust_off
trap 'trust_restore' EXIT
fresh_window_checked "$VT_STAND" "vt-stand" || return 1
# Open a ruby file: guarantees activation via onLanguage (proven by 2e4:
# workspaceContains alone leaves the window idle with extensions dead).
open_file "$VT_STAND/bad.rb"
palette_run "Reload Window"
# Reload may refocus the background qa-stand window: stray-tab grep on
# "vt-stand" false-positives via tab paths, so anchor on explorer root.
front_window "v vt-stand" || return 1
# Opening the file may reuse a hot-exit-restored tab (no onOpen event), and
# explicit palette Check is flaky here — so force onSave via touch_check
# (type space + palette Save) and poll the Problems panel. Panel-confined
# oracle on the cop name: the OCR-clipped row shows "invalid YAR...
# docscribe(Docscribe/InvalidType)" — full NotAType123 may not fit the
# column, and editor source never contains "InvalidType" (no false green).
open_file "$VT_STAND/bad.rb"
touch_check
got=0
for i in 1 2 3; do
  sleep 5
  problems
  shot "2e5-on-$i"
  ocr_text | grep -qi "Problems" || { echo "problems view not open" >&2; return 1; }
  panel_grep "$LAST_SHOT" "InvalidType" && { got=1; break; }
done
[[ $got -eq 1 ]] || { echo "InvalidType diagnostic missing in Problems" >&2; return 1; }
palette_run "DocScribe: Doctor"
dochunt "2e5-doc-on" "Validate types: *on" \
  || { echo "Validate types: on missing" >&2; return 1; }

# Surgical toggle (no cp bak: trust_off owns /tmp/gui-qa-settings.bak;
# a cp here would clobber it and mid-case restore drops later Reloads
# into Restricted Mode — proven by 2e4). Trap restores trust at exit.
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.validateTypes']=False; json.dump(d, open(p,'w'))"
palette_run "Reload Window"
front_window "v vt-stand" || { echo "screen not ready after reload" >&2; return 1; }
open_file "$VT_STAND/bad.rb"
# Cold host after Reload: "DocScribe: Doctor" may miss the palette while the
# extension host starts. Retry until the report header lands (proven 2e2/2e3
# pattern with palette_run_until_log for Check/fix).
doc_ok=0
for i in 1 2 3; do
  palette_run "DocScribe: Doctor"
  pageup 8
  shot "2e5-doc-off-head-$i"
  ocr_text | grep -qi "DocScribe version" && { doc_ok=1; break; }
  sleep 4
done
[[ $doc_ok -eq 1 ]] || { echo "Doctor never opened (cold host)" >&2; return 1; }
dochunt "2e5-doc-off" "Validate types: *off"
rc=$?
[[ $rc -eq 0 ]] || { echo "Validate types: off missing" >&2; return 1; }
# Off oracle is Doctor-only, by design: syntax-invalid YARD (NotAType123)
# is reported regardless of validate_types (gem validate gate covers
# infer/RBS mismatches, not syntax). The on/off engine gate itself is
# framework-covered (buildRbsCliOverrides/resolveRbsContext validate
# tests). GUI proves the setting reaches the effective config.
open_file "$VT_STAND/bad.rb"
problems
shot "2e5-off"
ocr_text | grep -qi "Problems" || { echo "problems view not open" >&2; return 1; }
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.validateTypes']=True; json.dump(d, open(p,'w'))"
# Leave the tab clean (buffer == disk): a dirty backup plus mk-recreated
# fixture races the next run into a compare/overwrite modal (proven 2026-09-13).
open_file "$VT_STAND/bad.rb"
palette_run "File: Save"
return 0
