#!/bin/zsh
# Reliable GUI actions only. No coordinate clicks, no modifier+symbol.
VSCODE_APP="${VSCODE_APP:-Visual Studio Code}"

activate() {
  osascript -e "tell application \"$VSCODE_APP\" to activate"
  sleep 0.5
}

# palette "<query>" — opens Cmd+Shift+P and types the query (no Enter).
palette() {
  activate
  osascript -e "tell application \"System Events\" to keystroke \"p\" using {command down, shift down}"
  sleep 1
  osascript -e "tell application \"System Events\" to keystroke \"$1\""
  sleep 2
}

# palette_run "<query>" — palette + Enter, waits for settle.
palette_run() {
  palette "$1"
  osascript -e 'tell application "System Events" to key code 36'
  sleep 3
}

# ctrl_g <line> — VSCode "go to line".
ctrl_g() {
  osascript -e 'tell application "System Events" to keystroke "g" using control down'
  sleep 0.8
  osascript -e "tell application \"System Events\" to keystroke \"$1\""
  sleep 0.3
  osascript -e 'tell application "System Events" to key code 36'
  sleep 1
}

# shift_f10 — context menu at cursor.
shift_f10() {
  osascript -e 'tell application "System Events" to key code 109 using {shift down}'
  sleep 1
}

escape() {
  osascript -e 'tell application "System Events" to key code 53'
  sleep 0.5
}

save() {
  osascript -e 'tell application "System Events" to keystroke "s" using command down'
  sleep 1.5
}

# click_text <shot-png> <grep-pattern> — click first OCR match center (retina-aware).
click_text() {
  local png="$1" pattern="$2"
  local xy
  xy=$(~/qa-vm-bin/vocr "$png" 2>/dev/null | python3 -c "
import json,sys,re
d = json.load(sys.stdin)
for o in d:
    if re.search(r'''$pattern''', o['text'], re.I):
        print(int((o['x'] + o['w'] / 2) / 2), int((o['y'] + o['h'] / 2) / 2))
        break
")
  if [[ -z "$xy" ]]; then
    echo "click_text: no match for /$pattern/ in $png" >&2
    return 1
  fi
  cliclick c:$xy
  sleep 1
}
# open_file <path> — via `code` CLI (no :line suffix; navigate with ctrl_g).
open_file() {
  code --reuse-window "$1" >/dev/null 2>&1
  sleep 2
  activate
}

STAND="${STAND:-$HOME/qa-stand}"

# mkstand — recreate driver fixtures inside the stand (bundle-ready).
mkstand() {
  cat > "$STAND/gui-undoc.rb" <<'RUBY'
class Widget
  def add(a, b)
    a + b
  end

  def sub(a, b)
    a - b
  end
end
RUBY
  cat > "$STAND/gui-partial.rb" <<'RUBY'
class Gadget
  # Old desc.
  def foo(a)
    a
  end
end
RUBY
}

# rmstand — remove driver fixtures.
rmstand() {
  rm -f "$STAND/gui-undoc.rb" "$STAND/gui-partial.rb"
}
