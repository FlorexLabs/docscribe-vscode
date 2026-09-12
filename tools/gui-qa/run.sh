#!/bin/zsh
# GUI QA runner: RSpec-style output, exit code = failure count.
cd "$(dirname "$0")"
source ./actions.sh
source ./assert.sh

echo "# versions: $(code --version 2>/dev/null | head -n 1) | ruby $(ruby --version 2>/dev/null) | $(date -u +%FT%TZ)"
echo "# ext: $(code --list-extensions --show-versions 2>/dev/null | grep -i docscribe | head -n 1)"

# Honesty gate: the installed build must match this working tree.
# Compares freshly compiled out/*.js against the installed extension.
if [[ "${SKIP_BUILD_CHECK:-}" != "1" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  ( cd "$ROOT" && npm run compile >/dev/null 2>&1 )
  installed="$HOME/.vscode/extensions/unurgunite.docscribe-vscode-0.1.3/out"
  if [[ ! -d "$installed" ]]; then
    echo "FATAL: extension not installed in this VM" >&2
    exit 2
  fi
  local_sum=$(cd "$ROOT/out" && find . -name '*.js' | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)
  inst_sum=$(cd "$installed" && find . -name '*.js' | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)
  if [[ "$local_sum" != "$inst_sum" ]]; then
    echo "FATAL: installed build is STALE (does not match working tree)." >&2
    echo "  Rebuild + reinstall: npx @vscode/vsce package && code --install-extension *.vsix --force" >&2
    exit 2
  fi
  echo "# build: honest (installed == tree)"
fi

# Clean slate: kill -9 is prompt-free (hot exit preserves tabs); stray windows
# steal palette focus and split logs, stale daemons poison recovery cases.
pkill -9 -f "/Applications/Visual Studio Code.app" 2>/dev/null
pkill -9 -f "docscribe server" 2>/dev/null
sleep 3
nohup open -a "Visual Studio Code" --args "$HOME/qa-stand" >/dev/null 2>&1 </dev/null &
sleep 6

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
exit $failures
