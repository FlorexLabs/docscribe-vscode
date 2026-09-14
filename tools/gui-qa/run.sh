#!/bin/zsh
# GUI QA runner: RSpec-style output, exit code = failure count.
cd "$(dirname "$0")" || exit 2
source ./actions.sh
source ./assert.sh

echo "# versions: $(code --version 2>/dev/null | head -n 1) | ruby $(ruby --version 2>/dev/null) | $(date -u +%FT%TZ)"
echo "# ext: $(code --list-extensions --show-versions 2>/dev/null | grep -i docscribe | head -n 1)"

# Run log: everything below lands here too (console keeps streaming).
RUN_LOG="/tmp/gui-qa/run-$(date +%Y%m%dT%H%M%S).log"
exec > >(tee "$RUN_LOG") 2>&1
echo "# run log: $RUN_LOG"

# Precondition: network for bundle installs. Fail-loud with the fix
# (host: python3 ~/qa-vm/forward-proxy.py), not 5 red 2e cases.
if ! curl -s -o /dev/null -w "%{http_code}" --max-time 20 https://rubygems.org/ 2>/dev/null | grep -q "200"; then
  echo "FATAL: no network to rubygems.org from this VM." >&2
  echo "  On the host: python3 ~/qa-vm/forward-proxy.py <host-ip> 18080 (&)" >&2
  exit 2
fi
echo "# net: rubygems reachable"

# Auto-build: the installed build must match this working tree.
# Rebuild + reinstall on drift (approved: always converge, never FATAL STALE).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
( cd "$ROOT" && npm run compile >/dev/null 2>&1 )
# NOTE: no glob here — zsh does not expand globs in scalar assignments.
ver=$(node -p "require('$ROOT/package.json').version" 2>/dev/null)
installed="$HOME/.vscode/extensions/unurgunite.docscribe-vscode-$ver/out"
if [[ ! -d $installed ]]; then
  echo "FATAL: extension not installed in this VM" >&2
  exit 2
fi
local_sum=$(cd "$ROOT/out" && find . -name '*.js' | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)
inst_sum=$(cd "$installed" && find . -name '*.js' | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)
if [[ "$local_sum" != "$inst_sum" ]]; then
  echo "# build: STALE — rebuilding + reinstalling from tree"
  ( cd "$ROOT" && rm -f *.vsix && npx @vscode/vsce package 2>&1 | tail -n 2 )
  code --install-extension "$ROOT"/*.vsix --force 2>&1 | tail -n 1
  inst_sum=$(cd "$installed" && find . -name '*.js' | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)
  if [[ "$local_sum" != "$inst_sum" ]]; then
    echo "FATAL: reinstall did not converge (still STALE)." >&2
    exit 2
  fi
fi
echo "# build: honest (installed == tree)"

# Clean slate: kill -9 is prompt-free, but hot exit preserves tabs and
# session storage replays stray windows + dirty backups on next launch
# (proven 2026-09-13: run N seeds run N+1). Wipe both so every run starts
# from the identical state — this is what makes reruns idempotent.
pkill -9 -f "/Applications/Visual Studio Code.app" 2>/dev/null
pkill -9 -f "Code Helper" 2>/dev/null
pkill -9 -f "docscribe server" 2>/dev/null
sleep 3
rm -rf "$HOME/Library/Application Support/Code/User/workspaceStorage" \
  "$HOME/Library/Application Support/Code/Backups"
# Baseline settings: cases toggle trust/useRbs/validateTypes with traps,
# but an interrupt mid-case still leaks. Normalize trust to the VS Code
# default (key absent) first — otherwise a leaked False perpetuates into
# every future baseline (proven 2026-09-13). Snapshot, restore at the end.
SET_FILE="$HOME/Library/Application Support/Code/User/settings.json"
python3 -c "import json; p='$SET_FILE'; d=json.load(open(p)); d.pop('security.workspace.trust.enabled', None); json.dump(d, open(p,'w'))"
cp "$SET_FILE" /tmp/gui-qa-settings.pristine
nohup open -a "Visual Studio Code" --args "$HOME/qa-stand" >/dev/null 2>&1 </dev/null &
# Gate: exactly 1 window before the first case (fail-loud, not cascade red).
windows_ok=0
for (( i = 1; i <= 24; i++ )); do
  sleep 5
  if [[ "$(window_count)" == "1" ]]; then
    windows_ok=1; break
  fi
done
[[ $windows_ok -eq 1 ]] || { echo "FATAL: expected 1 window after clean start (got $(window_count))." >&2; exit 2; }
echo "# start: clean (1 window, storage wiped, settings snapshotted)"

# Fresh extension host so the installed build is what we test.
activate
palette_run "Reload Window"

cases=("$@")
if [[ ${#cases} -eq 0 ]]; then
  cases=(cases/*.sh)
fi

failures=0
expected=0
for c in "${cases[@]}"; do
  id=$(basename "$c" .sh)
  if ( source "$c" ); then
    echo "ok $id"
  elif grep -qx "$id" cases/expected-fail.txt 2>/dev/null; then
    echo "expected fail $id"
    expected=$((expected + 1))
  else
    echo "not ok $id"
    failures=$((failures + 1))
  fi
done
echo "# $(( ${#cases} - failures ))/${#cases} passed"
echo "# end state: $(window_count) window(s) open"
# Restore pristine settings (covers trap-missing interrupt leaks).
cp /tmp/gui-qa-settings.pristine "$SET_FILE"
if cmp -s /tmp/gui-qa-settings.pristine "$SET_FILE"; then
  echo "# settings: restored to pre-run baseline"
else
  echo "# settings: RESTORE FAILED" >&2
fi
echo "# run log: $RUN_LOG"
exit $failures
