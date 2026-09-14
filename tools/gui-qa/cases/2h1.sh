#!/bin/zsh
# 2H.1: Ruby 4.0 + gem 1.6.2 + live daemon — Doctor header rows.
# The Doctor Ruby row shows the RESOLVED ruby (rbenv 4.0.6 shim): the
# extension learns Ruby through the configured rubyPath (default PATH
# shim = 3.4.5). Point rubyPath at the 4.0.6 binary (surgical, trap) so
# the whole extension + Doctor observe 4.0. Check before Doctor warms
# the daemon + capabilities (log-proven invocation).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
SET="$HOME/Library/Application Support/Code/User/settings.json"

mk_rb40_stand || return 1
trust_off
trap 'trust_restore' EXIT
RB40_RUBY="$HOME/.rbenv/versions/4.0.6/bin/ruby"
[[ -x "$RB40_RUBY" ]] || { echo "no rbenv 4.0.6 ruby" >&2; return 1; }
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.rubyPath']='$RB40_RUBY'; json.dump(d, open(p,'w'))"
window_gate "$RB40_STAND" || return 1
trust_on "$RB40_STAND" || return 1
# (front_window superseded by window_gate above)
escape
# RBS collection fixtures: symlink the repo collection lock so Doctor
# shows "Available" on every capability row (2H.2 shares this stand).
cp "$HOME/docscribe/rbs_collection.lock.yaml" "$RB40_STAND/" 2>/dev/null \
  || touch "$RB40_STAND/rbs_collection.lock.yaml"
open_file "$RB40_STAND/widget.rb"
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Check current file" "$log" "$before" \
  || { echo "check did not run (log unchanged)" >&2; return 1; }
palette_run "DocScribe: Doctor"
pageup 8
shot "2h1-head"
ocr_text | grep -qi "DocScribe Doctor" \
  || { echo "Doctor never opened" >&2; return 1; }
# Header oracle, confined to the Output panel (dochunt fullscreen).
dochunt "2h1" "Ruby: *ruby 4" || { echo "Ruby 4 row missing" >&2; return 1; }
dochunt "2h1-proj" "Project root: .*rb40-stand" \
  || { echo "project root row missing" >&2; return 1; }
dochunt "2h1-ver" "DocScribe version: 1" \
  || { echo "version row missing" >&2; return 1; }
return 0
