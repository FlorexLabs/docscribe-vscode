#!/bin/zsh
# Reliable GUI actions only. No coordinate clicks, no modifier+symbol.
VSCODE_APP="${VSCODE_APP:-Visual Studio Code}"

activate() {
  osascript -e "tell application \"$VSCODE_APP\" to activate"
  sleep 0.5
}

# palette "<query>" — opens Cmd+Shift+P and types the query (no Enter).
# Leading Escape makes it idempotent: a stale open palette would toggle
# shut on Cmd+Shift+P and eat the query (proven 2026-09-13, cascade desync).
palette() {
  osascript -e 'tell application "System Events" to key code 53'
  sleep 0.5
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

# problems — focus the Problems view via palette (hotkey unreliable headless).
problems() {
  palette "View: Show Problems"
  osascript -e 'tell application "System Events" to key code 36'
  sleep 2
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
  # NOTE: Cmd+S via keystroke is DEAD in this VM (proven 2026-09-13: ignored
  # even with editor focus). Palette Save is the only working save path.
  palette_run "File: Save"
}

# window_count — number of open VSCode windows via `code --status`.
# osascript window counting hangs headless; --status never does.
window_count() {
  code --status 2>/dev/null | grep -c -o "window \[[0-9]*\]"
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
        print(f\"{int((o['x'] + o['w'] / 2) / 2)},{int((o['y'] + o['h'] / 2) / 2)}\")
        break
")
  if [[ -z "$xy" ]]; then
    echo "click_text: no match for /$pattern/ in $png" >&2
    return 1
  fi
  cliclick c:$xy
  sleep 1
}
# pageup [n] — Page Up n times in the focused view (default 4).
pageup() {
  local n="${1:-4}" i
  for (( i = 0; i < n; i++ )); do
    osascript -e 'tell application "System Events" to key code 116'
    sleep 0.3
  done
}

# pagedown [n] — Page Down n times in the focused view (default 2).
pagedown() {
  local n="${1:-2}" i
  for (( i = 0; i < n; i++ )); do
    osascript -e 'tell application "System Events" to key code 121'
    sleep 0.3
  done
}
# down [n] / up [n] — arrow keys (fine scroll ~1 line/step, overlapping coverage).
down() {
  local n="${1:-1}" i
  for (( i = 0; i < n; i++ )); do
    osascript -e 'tell application "System Events" to key code 125'
    sleep 0.2
  done
}
up() {
  local n="${1:-1}" i
  for (( i = 0; i < n; i++ )); do
    osascript -e 'tell application "System Events" to key code 126'
    sleep 0.2
  done
}
# close_window — DEAD in this VM (Cmd+Shift+W ignored like all single-letter
# Cmd+keystrokes, proven 2026-09-13). Kept for fresh_window structure; window
# cleanup happens via pre-run pkill in run.sh, NOT here. Do not rely on it.
close_window() {
  osascript -e 'tell application "System Events" to keystroke "w" using {command down, shift down}'
  sleep 2
}
# close_editor — DEAD in this VM (Cmd+W ignored, proven 2026-09-13; focus
# tricks and click_text on the × do not help). Kept as harmless no-op.
# Oracles must be panel-confined (panel_grep), never depend on closed tabs.
close_editor() {
  osascript -e 'tell application "System Events" to keystroke "w" using command down'
  sleep 1
}

# save_all — File: Save All Files via palette (no focus needed).
save_all() {
  palette "File: Save All Files"
  osascript -e 'tell application "System Events" to key code 36'
  sleep 2
}
# fresh_window <dir> — close the front window, open dir in a new window.
# Needed because `code -r <dir>` does not reliably retarget a live window's
# workspaceFolders[0] (proven 2026-09-13: Doctor kept reporting qa-stand).
fresh_window() {
  close_window
  code "$1" >/dev/null 2>&1
  sleep 10
  activate
}
# front_window <pattern> [tries=4] — ensure the FRONT window is ours.
# After Reload Window macOS may refocus a background stand window; later
# open_file/palette then land in the wrong project as stray tabs (proven
# 2026-09-13: 2e5 off-phase edited qa-stand). Cycle Cmd+` until the
# explorer root matches. Pattern like "v vt-stand" (OCR of explorer root).
front_window() {
  local tries="${2:-4}" i
  for (( i = 1; i <= tries; i++ )); do
    shot "front-$i"
    if ocr_text | grep -qi "$1"; then
      return 0
    fi
    osascript -e 'tell application "System Events" to keystroke "`" using command down'
    sleep 1
  done
  echo "front window has no /$1/ after $tries tries" >&2; return 1
}
# touch_check — force extension onSave (checkDocument) without Cmd+S.
# Single-letter Cmd+keystrokes (Cmd+S/W/N) are dead in this VM (proven
# 2026-09-13: ignored even with editor focus), but palette commands and
# key codes work. Types a space (harmless trailing whitespace) and saves
# via palette, which fires onDidSaveTextDocument -> auto-check.
# NOTE: leaves a trailing space in the file; fixtures are recreated per
# case (mk*), so no cross-run dirt. Prefer palette Check commands when the
# file content must stay byte-clean.
touch_check() {
  osascript -e 'tell application "System Events" to key code 49'
  sleep 1
  save
}
# palette_run_until_log <command> <log> <before> [tries=3] — rerun the palette
# command until the log fingerprint changes. Covers the post-open activation
# race (command missing from palette while the extension host starts).
palette_run_until_log() {
  local tries="${4:-3}" i after
  for (( i = 1; i <= tries; i++ )); do
    palette_run "$1"
    after=$(log_mark "$2")
    [[ "$after" != "$3" ]] && return 0
    sleep 5
  done
  return 1
}
# trust_off / trust_restore — Workspace Trust prompt blocks palette automation
# on never-opened folders; disable around fresh_window, restore after.
trust_off() {
  cp "$HOME/Library/Application Support/Code/User/settings.json" /tmp/gui-qa-settings.bak
  python3 -c "import json; p='$HOME/Library/Application Support/Code/User/settings.json'; d=json.load(open(p)); d['security.workspace.trust.enabled']=False; json.dump(d, open(p,'w'))"
}
trust_restore() {
  cp /tmp/gui-qa-settings.bak "$HOME/Library/Application Support/Code/User/settings.json"
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

# --- 2E stands (RBS auto-detect / balloon / validate-types) ---
# Guest-only builders (paths are guest paths). Additive; no existing behavior.
MATRIX="${MATRIX:-/tmp/rbs-matrix}"
RBS_STAND="${RBS_STAND:-/tmp/rbs-stand}"
NORBS_STAND="${NORBS_STAND:-/tmp/norbs-stand}"
VT_STAND="${VT_STAND:-/tmp/vt-stand}"
DOCSCRIBE_PATH_GEM="${DOCSCRIBE_PATH_GEM:-$HOME/docscribe}"

# _rbs_gemfile <dir> [with-rbs] — minimal Gemfile on the path gem.
_rbs_gemfile() {
  cat > "$1/Gemfile" <<EOF
source "https://rubygems.org"
gem "docscribe", path: "$DOCSCRIBE_PATH_GEM"
EOF
  if [[ "${2:-0}" == "1" ]]; then
    echo 'gem "rbs"' >> "$1/Gemfile"
  fi
}

# _rbs_probe <dir> [basename] — trivial documented class to open in GUI.
_rbs_probe() {
  cat > "$1/${2:-probe}.rb" <<'RUBY'
class Probe
  def hello(name)
    "hi #{name}"
  end
end
RUBY
}

# _rbs_bundle <dir> — resolve offline-ish; prints tail for the log.
_rbs_bundle() {
  (cd "$1" && bundle install --quiet 2>&1 | tail -n 3)
}

# mk_rbs_stand — RBS project with collection (shared by 2e2/2e3).
mk_rbs_stand() {
  rm -rf "$RBS_STAND"
  mkdir -p "$RBS_STAND/sig"
  _rbs_gemfile "$RBS_STAND" 1
  cp "$HOME/docscribe/rbs_collection.lock.yaml" "$RBS_STAND/" 2>/dev/null \
    || touch "$RBS_STAND/rbs_collection.lock.yaml"
  printf 'class Widget\n  def add: (Integer a, Integer b) -> Integer\nend\n' \
    > "$RBS_STAND/sig/widget.rbs"
  cat > "$RBS_STAND/widget.rb" <<'RUBY'
class Widget
  # Adds two numbers.
  def add(a, b)
    a + b
  end
end
RUBY
  _rbs_bundle "$RBS_STAND" || return 1
  return 0
}

# mk_norbs_stand — project without rbs (balloon target). Keeps .norbs backup.
mk_norbs_stand() {
  rm -rf "$NORBS_STAND"
  mkdir -p "$NORBS_STAND"
  _rbs_gemfile "$NORBS_STAND" 0
  cp "$NORBS_STAND/Gemfile" "$NORBS_STAND/Gemfile.norbs"
  _rbs_probe "$NORBS_STAND"
  _rbs_bundle "$NORBS_STAND" || return 1
  return 0
}

# mk_vt_stand — validate-types project with an invalid YARD type.
mk_vt_stand() {
  rm -rf "$VT_STAND"
  mkdir -p "$VT_STAND"
  _rbs_gemfile "$VT_STAND" 0
  cat > "$VT_STAND/bad.rb" <<'RUBY'
class Widget
  # @param [NotAType123] x does thing.
  def foo(x)
    x
  end
end
RUBY
  _rbs_bundle "$VT_STAND" || return 1
  return 0
}
