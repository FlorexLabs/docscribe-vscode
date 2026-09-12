#!/bin/zsh
# 2D.9: custom bundlePath wrapper is used; LANG-unset launch marks en_US.UTF-8.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"
SET="$HOME/Library/Application Support/Code/User/settings.json"

activate
cp "$SET" /tmp/gui-qa-settings.bak
cat > /tmp/gui-bundle-wrap.sh <<'WRAP'
#!/bin/zsh
echo CUSTOM-BUNDLE >> /tmp/gui-bundle-probe.log
exec /Users/admin/.rbenv/shims/bundle "$@"
WRAP
chmod +x /tmp/gui-bundle-wrap.sh
rm -f /tmp/gui-bundle-probe.log
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.bundlePath']='/tmp/gui-bundle-wrap.sh'; json.dump(d, open(p,'w'))"
# Reload: guarantees the new bundlePath is live (file-watcher timing is racy).
palette_run "Reload Window"
# Force daemon respawn so the wrapper is actually exec'd (server path uses RPC otherwise).
# Pattern-kill: pidfiles can disagree with reality across kill -9 cycles.
pkill -9 -f "docscribe server" 2>/dev/null
sleep 1
open_file "$STAND/clean.rb"
palette_run "DocScribe: Check current file"
# Daemon spawn via bundler is slow on first boot (~15-30s); poll wide.
# NOTE: restore settings only AFTER the probe: spawn reads bundlePath live,
# and an early restore would flip it back to the real bundle first.
for (( i = 0; i < 40; i++ )); do
  grep -q "CUSTOM-BUNDLE" /tmp/gui-bundle-probe.log 2>/dev/null && break
  sleep 1
done
grep -q "CUSTOM-BUNDLE" /tmp/gui-bundle-probe.log 2>/dev/null || { echo "custom bundle not used" >&2; cp /tmp/gui-qa-settings.bak "$SET"; return 1; }
cp /tmp/gui-qa-settings.bak "$SET"
palette_run "Reload Window"
# Part 2: Doctor documents the daemon locale (must be UTF-8).
# NOTE: a literally-unset LANG is not constructible here (LaunchServices
# injects en_US.UTF-8 into GUI apps); the "(unset)" rendering + fallback are
# covered by framework tests (docscribeClient doctor/locale suites).
activate
palette_run "DocScribe: Doctor"
pageup 4
found=0
for (( i = 1; i <= 4; i++ )); do
  pagedown 1
  shot "2d9-$i"
  if ocr_text | grep -qi "Locale:.*en_US.UTF-8"; then
    found=1
    cp "$SHOT_DIR/2d9-$i.png" "$SHOT_DIR/2d9.png"
    break
  fi
done
[[ $found -eq 1 ]] || return 1
return 0
