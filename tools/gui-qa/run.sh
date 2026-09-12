#!/bin/zsh
# GUI QA runner: RSpec-style output, exit code = failure count.
cd "$(dirname "$0")"
source ./actions.sh
source ./assert.sh

echo "# versions: $(code --version 2>/dev/null | head -n 1) | ruby $(ruby --version 2>/dev/null) | $(date -u +%FT%TZ)"

cases=("$@")
if [[ ${#cases} -eq 0 ]]; then
  cases=(cases/*.sh)
fi

failures=0
for c in "${cases[@]}"; do
  id=$(basename "$c" .sh)
  if ( source "$c" ); then
    echo "ok $id"
  else
    echo "not ok $id"
    failures=$((failures + 1))
  fi
done
echo "# $(( ${#cases} - failures ))/${#cases} passed"
exit $failures
