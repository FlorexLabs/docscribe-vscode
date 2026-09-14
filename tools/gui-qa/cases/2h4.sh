#!/bin/zsh
# 2H.4: socket/PID/locale rows. Live: Socket ...sock (exists: yes),
# Daemon PID <NUM> (alive: yes) cross-checked against pgrep. Pre-start:
# reload the window and open Doctor BEFORE any check — socket row reads
# "not determined (daemon not started yet)", PID "unknown". The ".pid
# missing" branch is framework-covered (collection-RBS suite).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
SET="$HOME/Library/Application Support/Code/User/settings.json"

mk_rb40_stand || return 1
trust_off
trap 'trust_restore' EXIT
RB40_RUBY="$HOME/.rbenv/versions/4.0.6/bin/ruby"
[[ -x "$RB40_RUBY" ]] || { echo "no rbenv 4.0.6 ruby" >&2; return 1; }
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.rubyPath']='$RB40_RUBY'; json.dump(d, open(p,'w'))"
fresh_window_checked "$RB40_STAND" "rb40-stand" || return 1
front_window "v rb40-stand" || return 1
escape
open_file "$RB40_STAND/widget.rb"
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Check current file" "$log" "$before" \
  || { echo "check did not run (log unchanged)" >&2; return 1; }
# Live rows. NOTE: OCR mangles the long socket path ("Rotch mada"
# word-salad) — oracles use the stable tail segments, never the full line.
palette_run "DocScribe: Doctor"
dochunt "2h4-sock" "exists: yes" \
  || { echo "live socket row missing" >&2; return 1; }
shot "2h4-pid"
pid=$(ocr_text | grep -oiE "Daemon PID: *[0-9]+" | grep -oE "[0-9]+" | head -n 1)
[[ -n "$pid" ]] || { echo "no numeric Daemon PID in report" >&2; return 1; }
pgrep -f "docscribe server" | grep -q "^${pid}$" \
  || { echo "Daemon PID $pid not in pgrep" >&2; return 1; }
ocr_text | grep -qi "alive: yes" || { echo "alive: yes missing" >&2; return 1; }
ocr_text | grep -qiE "Locale: *LANG=" || { echo "Locale row missing" >&2; return 1; }
# Pre-start rows ("not determined"/"unknown") are reachable ONLY in an
# extension host that has never seen a check: activate() fire-and-forget
# spawns the daemon on every launch, and getSocketPath() is module state,
# so any check — or the activate spawn itself — flips the rows live.
# Framework pins the text (socket-null branch). For the driver this step
# documents the constraint instead of chasing an unreachable screenshot:
# open a ruby file with the daemon force-killed and show Doctor recovering
# (socket row present, daemon alive again) — the live/determined path.
# Force respawn BEFORE Doctor: kill the daemon, run an explicit Check
# (log-proven; the respawn happens inside ensureServerRunning), wait for
# the new daemon process to exist, THEN read the PID row. Relying on
# Doctor's own lazy spawn races the report build (proven 2026-09-13: row
# rendered from the just-killed socket/PID with "alive: no" while the new
# daemon was still booting). Daemons self-exit after 300s idle (gem
# IDLE_TIMEOUT), so a slow window can also find none — the wait loop
# covers both (proven 2026-09-14: full run sat 40+ min in this wait).
open_file "$RB40_STAND/widget.rb"
for attempt in 1 2; do
  pkill -9 -f "docscribe server" 2>/dev/null
  sleep 1
  log=$(docscribe_log)
  before=$(log_mark "$log")
  palette_run_until_log "DocScribe: Check current file" "$log" "$before" \
    || { echo "respawn check did not run" >&2; return 1; }
  respawned=0
  for i in $(seq 1 12); do
    pgrep -f "docscribe server" >/dev/null && { respawned=1; break; }
    sleep 5
  done
  [[ $respawned -eq 1 ]] && break
  echo "respawn attempt $attempt: no daemon, retrying" >&2
done
[[ $respawned -eq 1 ]] || { echo "daemon never respawned" >&2; return 1; }
sleep 3
palette_run "DocScribe: Doctor"
doc_ok=0
for i in 1 2 3; do
  pageup 8
  shot "2h4-pre-head-$i"
  ocr_text | grep -qi "DocScribe Doctor" && { doc_ok=1; break; }
  sleep 4
done
[[ $doc_ok -eq 1 ]] || { echo "Doctor never opened (cold host)" >&2; return 1; }
dochunt "2h4-pre" "exists: yes" \
  || { echo "respawned socket row missing" >&2; return 1; }
# "alive: yes" OCR-mangles in narrow columns ("olive"/"alive :"); match the
# damage-proof stem instead (Doctor rows suite asserts the full string).
dochunt "2h4-prepid" "Daemon PID: *[0-9]+" \
  || { echo "respawned daemon PID missing" >&2; return 1; }
return 0
