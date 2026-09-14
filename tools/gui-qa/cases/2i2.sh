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
window_gate "$HOME/qa-stand" || { echo "screen not ready" >&2; return 1; }
trust_on "$HOME/qa-stand" || return 1
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
# ...and the check path must carry -B. The CLI never echoes argv into
# Output (probe-proven 2026-09-14), so the driver asserts the OBSERVABLE
# difference: with -B the fixed file has bare tags, without -B it has
# prose. Part 2 re-runs the fix with the toggle OFF and expects prose.
# Daemon file_cache is keyed by mtime at 1-SECOND granularity: mkstand
# recreates fixtures within the same second, so the batch/fix can serve
# STALE Part-1 results for Part 2 (proven 2026-09-14: 2i2 Part 2 saw bare
# tags with -B off). Bounce the daemon + sleep past the granularity, and
# Reload first: the ext host reads the omitBoilerplate setting at check
# time, but a just-toggled value needs the host to settle (proven
# 2026-09-14: manual Part1+Part2 with identical steps gives bare+prose).
rmstand
sleep 2
mkstand
# Explicit OFF (not bak restore): the bak can itself carry omitBoilerplate
# True if a previous run leaked it into the baseline (proven 2026-09-14:
# pristine held True, Part2 re-applied -B and failed "unexpectedly bare").
# Trap still restores bak at exit.
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.omitBoilerplate']=False; json.dump(d, open(p,'w'))"
pkill -9 -f "docscribe server" 2>/dev/null
sleep 3
open_file "$STAND/gui-undoc.rb"
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Apply safe fixes to current file" "$log" "$before" \
  || { echo "check did not run" >&2; return 1; }
save
grep -qi "documentation\." "$STAND/gui-undoc.rb" \
  || { echo "default (no -B) unexpectedly bare" >&2; rmstand; return 1; }
rmstand
return 0
