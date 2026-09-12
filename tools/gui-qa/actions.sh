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

# open_file <path> — via `code` CLI (no :line suffix; navigate with ctrl_g).
open_file() {
  code --reuse-window "$1" >/dev/null 2>&1
  sleep 2
  activate
}
