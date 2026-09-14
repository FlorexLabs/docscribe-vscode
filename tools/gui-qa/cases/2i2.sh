#!/bin/zsh
# 2I.2: Omit Boilerplate on -> -B in BOTH paths: safe-fix writes the file
# without template text, and check Output shows the -B flag. Off (default)
# keeps boilerplate. Surgical toggle (trap owns the trust bak).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
SET="$HOME/Library/Application Support/Code/User/settings.json"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
trust_off
trap 'trust_restore' EXIT
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.omitBoilerplate']=True; json.dump(d, open(p,'w'))"
palette_run "Reload Window"
front_window "qa-stand" || { echo "screen not ready" >&2; return 1; }
open_file "$STAND/gui-undoc.rb"
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Apply safe fixes to current file" "$log" "$before" \
  || { echo "safe fix did not run" >&2; return 1; }
save
# -B strips the prose scaffolding: the generated doc lines carry no
# descriptions ("Param documentation."/"Method documentation."), only
# bare tags (probe-proven 2026-09-14: -aB output has zero description
# sentences vs -a output which has them).
grep -qi "documentation\." "$STAND/gui-undoc.rb" \
  && { echo "-B did not suppress boilerplate in fix output" >&2; return 1; }
grep -q "@param" "$STAND/gui-undoc.rb" \
  || { echo "fix wrote no tags at all" >&2; return 1; }
# ...and the check path must carry -B (Output shows the effective flags).
rmstand
mkstand
open_file "$STAND/gui-undoc.rb"
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Check current file" "$log" "$before" \
  || { echo "check did not run" >&2; return 1; }
rmstand
python3 -c "import json; b=json.load(open('/tmp/gui-qa-settings.bak')); json.dump(b, open('$SET','w'))"
# -B: the CLI prints the resolved flag set into the Output channel.
panelhunt "2i2" "\-B" || { echo "-B missing in check Output" >&2; return 1; }
return 0
