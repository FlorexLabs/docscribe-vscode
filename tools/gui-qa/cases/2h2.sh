#!/bin/zsh
# 2H.2/2H.3/2H.5: capability rows + backend/RBS/validate/Capabilities +
# settings block (9 rows, fixed order). Same rb40 stand: 4.0 renders every
# capability as Available (server/batch/exit semantics proven by matrix).
# 2H.4 (socket/PID/locale) and 2H.6 (no-ruby PATH) and 2H.7 (no gem) live
# in their own cases; framework covers the variants (Doctor rows suite).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
SET="$HOME/Library/Application Support/Code/User/settings.json"

mk_rb40_stand || return 1
trust_off
trap 'trust_restore' EXIT
RB40_RUBY="$HOME/.rbenv/versions/4.0.6/bin/ruby"
[[ -x "$RB40_RUBY" ]] || { echo "no rbenv 4.0.6 ruby" >&2; return 1; }
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.rubyPath']='$RB40_RUBY'; json.dump(d, open(p,'w'))"
cp "$HOME/docscribe/rbs_collection.lock.yaml" "$RB40_STAND/" 2>/dev/null \
  || touch "$RB40_STAND/rbs_collection.lock.yaml"
window_gate "$RB40_STAND" || return 1
trust_on "$RB40_STAND" || return 1
# (front_window superseded by window_gate above)
escape
open_file "$RB40_STAND/widget.rb"
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Check current file" "$log" "$before" \
  || { echo "check did not run (log unchanged)" >&2; return 1; }
palette_run "DocScribe: Doctor"
pageup 8
shot "2h2-head"
ocr_text | grep -qi "DocScribe Doctor" \
  || { echo "Doctor never opened" >&2; return 1; }
# 2H.2 capability rows (explicit tags: pattern text is not filename-safe —
# spaces and * splat into garbage tags, proven 2026-09-13: 2h2 hunted 48
# screenshots and never matched because dochunt restarts at the top per
# row while the report had already scrolled).
dochunt "2h2-server" "Server mode: *Available" \
  || { echo "capability row Server mode missing" >&2; return 1; }
dochunt "2h2-batch" "Batch mode.*Available" \
  || { echo "capability row Batch mode missing" >&2; return 1; }
dochunt "2h2-coll" "RBS collection: *Available" \
  || { echo "capability row RBS collection missing" >&2; return 1; }
dochunt "2h2-exit" "Exit code semantics: *Available" \
  || { echo "capability row Exit code semantics missing" >&2; return 1; }
# 2H.3 backend + RBS + validate + capabilities JSON.
dochunt "2h3-be" "Backend: server" \
  || { echo "Backend row missing" >&2; return 1; }
dochunt "2h3-vt" "Validate types: *on" \
  || { echo "Validate types row missing" >&2; return 1; }
dochunt "2h3-caps" "hasUpdateTypesRpc" \
  || { echo "Capabilities JSON missing" >&2; return 1; }
# 2H.5 settings block: 9 rows in order (framework asserts the order;
# driver proves the block renders end-to-end in the real panel).
for row in "runOnSave" "useBundleExec" "useRbs" "validateTypes" "useServer" \
  "commandPath" "ignorePatterns" "foldComments" "omitBoilerplate"; do
  dochunt "2h5-$row" "$row" \
    || { echo "settings row $row missing" >&2; return 1; }
done
return 0
