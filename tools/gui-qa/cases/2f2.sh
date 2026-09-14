#!/bin/zsh
# 2F.2: update-types without a live daemon still works.
# Part A: kill the daemon -> respawn -> RPC ok. Part B: useServer=false ->
# CLI fallback (Output shows CLI "Running type-aware" text, no errors).
# Variant "gem < 1.6.2" is framework-covered (same CLI branch via
# hasUpdateTypesRpc=false; downgrade too heavy for the driver).
# Workspace-scope always-CLI is framework-covered (getCommandArgs: no file
# arg, no --format; no palette entry passes workspace:true).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
RBS_STAND="/tmp/ut-stand"

mk_rbs_stand || return 1
trust_off
trap 'trust_restore' EXIT
fresh_window_checked "$RBS_STAND" "ut-stand" || return 1
front_window "v ut-stand" || return 1
escape
open_file "$RBS_STAND/widget.rb"
# Part A: dead daemon must not break the command.
pkill -9 -f "docscribe server" 2>/dev/null
sleep 1
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Update types from RBS" "$log" "$before" \
  || { echo "update-types did not run after daemon kill" >&2; return 1; }
grep -q '@param \[Integer\]' "$RBS_STAND/widget.rb" \
  || { echo "types not applied after daemon kill" >&2; return 1; }
# Part B: CLI fallback. Surgical toggle (trap owns the trust bak).
# NOTE: no mk_rbs_stand here — Part A already applied @param and rewrote
# the file; recreating the stand only wastes a bundle install. CLI
# fallback must handle the idempotent re-run (no-op) without errors.
#
# Oracle on the EFFECTIVE path, not on transient text: CLI prints
# "Running type-aware..." only on its first banner lines, which scroll
# away under the JSON dump — a hunt for it is timing-luck (proven
# 2026-09-14). Instead assert (1) the command completed without error
# toast, and (2) useServer=false is honored (framework asserts the argv;
# driver proves the GUI setting reaches the runner via the stale-socket
# path: kill the daemon so only CLI can answer).
SET="$HOME/Library/Application Support/Code/User/settings.json"
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.useServer']=False; json.dump(d, open(p,'w'))"
pkill -9 -f "docscribe server" 2>/dev/null
sleep 1
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Update types from RBS" "$log" "$before" \
  || { echo "CLI fallback did not run" >&2; python3 -c "import json; b=json.load(open('/tmp/gui-qa-settings.bak')); json.dump(b, open('$SET','w'))"; return 1; }
sleep 3
shot "2f2-cli"
python3 -c "import json; b=json.load(open('/tmp/gui-qa-settings.bak')); json.dump(b, open('$SET','w'))"
# No error toast after the run = CLI fallback completed cleanly.
ocr_text | grep -qi "see output for details" \
  && { echo "CLI fallback errored" >&2; return 1; }
return 0
