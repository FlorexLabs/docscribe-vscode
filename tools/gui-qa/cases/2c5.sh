#!/bin/zsh
# 2C.5: Problems view lists entries incl. invalid-type code (severity colors: framework).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
cat > "$STAND/gui-badtype.rb" <<'RUBY'
class Bad
  # @param [Sym bol] x
  def show(x)
    x.to_s
  end
end
RUBY
open_file "$STAND/gui-badtype.rb"
palette_run "DocScribe: Check current file"
problems
rm -f "$STAND/gui-badtype.rb"
rmstand
# Panel-confined: the editor tab title "gui-badtype.rb" would false-green a
# fullscreen grep even with an empty Problems panel (proven 2026-09-13).
shot "2c5"
ocr_text | grep -qi "Problems" || { echo "problems view not open" >&2; return 1; }
panel_grep "$LAST_SHOT" "gui-badtype" || return 1
return 0
