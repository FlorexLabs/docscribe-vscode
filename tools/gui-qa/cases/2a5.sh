#!/bin/zsh
# 2A.5: gem-missing gate warns on reload (EXPECTED FAIL on release: card 495).
# Setup: fixture project whose Gemfile lacks docscribe (bundled once).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

proj=/tmp/gui-nogem
if [[ ! -f "$proj/Gemfile.lock" ]]; then
  mkdir -p "$proj"
  printf 'source "https://rubygems.org"\ngem "rake"\n' > "$proj/Gemfile"
  printf 'def hello(name)\n  "hi"\nend\n' > "$proj/foo.rb"
  ( cd "$proj" && bundle install --local >/dev/null 2>&1 || bundle install >/dev/null 2>&1 )
fi
activate
code --reuse-window "$proj/foo.rb" >/dev/null 2>&1
sleep 2
activate
palette_run "Reload Window"
sleep 4
assert_ocr "2a5" "not found" || return 1
return 0
