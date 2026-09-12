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
assert_ocr_retry "2c5" "gui-badtype" 2 || return 1
return 0
