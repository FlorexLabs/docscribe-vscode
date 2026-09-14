#!/bin/zsh
# Reliable GUI actions only. No coordinate clicks, no modifier+symbol.
VSCODE_APP="${VSCODE_APP:-Visual Studio Code}"

# osa — osascript with retry on transient AppleEvent failures.
# Proven 2026-09-14: plain osascript intermittently dies with
# "41:49: execution error: Connection is invalid. (-609)" mid-run
# (AppleEvents to Code dropped under load), silently no-opping the
# keystroke. Every automation keystroke below routes through osa so a
# single dropped event retries instead of desyncing the whole case.
# Double-delivery risk: only idempotent presses route here with retries;
# free-text typing callers pass OSA_NORETRY=1 (a retried query would
# append duplicate text; upper layers re-run the whole palette instead).
osa() {
  local tries="${OSA_TRIES:-3}" i=0 out
  while (( i < tries )); do
    i=$((i + 1))
    out=$(osascript "$@" 2>&1) && { [[ -n "$out" ]] && echo "$out"; return 0; }
    echo "osa try $i/$tries failed: $out" >&2
    [[ -n "${OSA_NORETRY:-}" ]] && return 1
    sleep 2
  done
  return 1
}

activate() {
  osa -e "tell application \"$VSCODE_APP\" to activate"
  sleep 0.5
}

# palette "<query>" — opens Cmd+Shift+P and types the query (no Enter).
# Leading Escape makes it idempotent: a stale open palette would toggle
# shut on Cmd+Shift+P and eat the query (proven 2026-09-13, cascade desync).
palette() {
  osa -e 'tell application "System Events" to key code 53'
  sleep 0.5
  activate
  osa -e "tell application \"System Events\" to keystroke \"p\" using {command down, shift down}"
  sleep 1
  # Free-text typing: single-shot (OSA_NORETRY=1). A retried query would
  # append duplicate text; upper layers re-run the whole palette instead
  # (palette self-resets via leading Escape).
  OSA_NORETRY=1 osa -e "tell application \"System Events\" to keystroke \"$1\""
  sleep 2
}

# palette_run "<query>" — palette + Enter, waits for settle.
palette_run() {
  palette "$1"
  osa -e 'tell application "System Events" to key code 36'
  sleep 3
}

# ctrl_g <line> — VSCode "go to line".
ctrl_g() {
  osa -e 'tell application "System Events" to keystroke "g" using control down'
  sleep 0.8
  # Free-text typing: single-shot, see palette() above.
  OSA_NORETRY=1 osa -e "tell application \"System Events\" to keystroke \"$1\""
  sleep 0.3
  osa -e 'tell application "System Events" to key code 36'
  sleep 1
}

# problems — focus the Problems view via palette (hotkey unreliable headless).
problems() {
  palette "View: Show Problems"
  osa -e 'tell application "System Events" to key code 36'
  sleep 2
}
# shift_f10 — context menu at cursor.
shift_f10() {
  osa -e 'tell application "System Events" to key code 109 using {shift down}'
  sleep 1
}

escape() {
  osa -e 'tell application "System Events" to key code 53'
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
# tab_click <shot-png> <pattern> — click a tab by OCR text (retina-aware).
# Cmd+W is dead in this VM, so switching tabs (not closing) is the way to
# change the active editor. Unlike click_text, matches against the TOP tab
# strip only (y < 400 @2x), so panel/explorer copies of the name can't win.
tab_click() {
  local png="$1" pattern="$2"
  local xy
  xy=$(~/qa-vm-bin/vocr "$png" 2>/dev/null | python3 -c "
import json,sys,re
d = json.load(sys.stdin)
for o in d:
    if o['y'] < 400 and re.search(r'''$pattern''', o['text'], re.I):
        print(f\"{int((o['x'] + o['w'] / 2) / 2)},{int((o['y'] + o['h'] / 2) / 2)}\")
        break
")
  if [[ -z "$xy" ]]; then
    echo "tab_click: no tab match for /$pattern/ in $png" >&2
    return 1
  fi
  cliclick c:$xy
  sleep 1.5
}
# pageup [n] — Page Up n times in the focused view (default 4).
pageup() {
  local n="${1:-4}" i
  for (( i = 0; i < n; i++ )); do
    osa -e 'tell application "System Events" to key code 116'
    sleep 0.3
  done
}

# pagedown [n] — Page Down n times in the focused view (default 2).
pagedown() {
  local n="${1:-2}" i
  for (( i = 0; i < n; i++ )); do
    osa -e 'tell application "System Events" to key code 121'
    sleep 0.3
  done
}
# down [n] / up [n] — arrow keys (fine scroll ~1 line/step, overlapping coverage).
down() {
  local n="${1:-1}" i
  for (( i = 0; i < n; i++ )); do
    osa -e 'tell application "System Events" to key code 125'
    sleep 0.2
  done
}
up() {
  local n="${1:-1}" i
  for (( i = 0; i < n; i++ )); do
    osa -e 'tell application "System Events" to key code 126'
    sleep 0.2
  done
}
# close_window — Cmd+Shift+W keystroke closes the FRONT window (menu
# accelerator; proven 2026-09-14 while palette "File: Close Window" only
# focused the menu and never fired).
# Verified variant (proven 2026-09-14, full run 27/46 post-mortem): the
# keystroke silently no-ops when (a) focus is not in Code, or (b) a SAVE
# DIALOG blocks the close ("Do you want to save the changes you made to
# gui-undoc.rb?" — dirtied by touch_check/fix, dialog up BEFORE save_all
# could run; palette can't open under a modal, so save_all is helpless).
# So: save_all first, activate first, then keystroke, then VERIFY via
# window_count and retry — and if the count stalls, screenshot for the
# save dialog and click "Don't Save" via OCR coords (fixtures are
# recreated per case, nothing worth keeping). Fail-loud instead of
# accumulating ghosts that drown window_gate (n=7..9 in the red run).
close_window() {
  local tries="${1:-3}" i before
  for (( i = 1; i <= tries; i++ )); do
    before=$(window_count)
    save_all
    activate
    osa -e 'tell application "System Events" to keystroke "w" using {command down, shift down}'
    sleep 3
    if [[ "$(window_count)" -lt "$before" ]]; then
      return 0
    fi
    shot "close-dlg-$i"
    if ocr_text | grep -qi "Do you want to save"; then
      echo "close_window: save dialog up, clicking Don't Save" >&2
      # Anchored button pattern: bare "Don.t Save" ALSO matches the body
      # text "don't save them." (which OCR lists FIRST), so the click
      # landed on static text and the dialog survived all 3 tries
      # (proven 2026-09-14: full run cascade). ^$ pins the button.
      click_text "$LAST_SHOT" "^Don.t Save$" || true
      sleep 2
      if [[ "$(window_count)" -lt "$before" ]]; then
        return 0
      fi
    fi
  done
  echo "close_window: still $(window_count) windows after $tries tries (was $before)" >&2
  return 1
}
# close_editor — Cmd+W closes the active editor tab (file must be saved).
# Needed before Problems-absence shots: editor source text would match the
# forbidden pattern fullscreen (proven 2026-09-13, 2e5-off false red).
close_editor() {
  palette_run "View: Close Editor"
}

# save_all — File: Save All Files via palette (no focus needed).
save_all() {
  palette "File: Save All Files"
  osa -e 'tell application "System Events" to key code 36'
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
# window_gate <dir> [tries=6] — hermetic per-case window state.
# Kills the multi-window roulette at the root: closes windows until exactly
# ONE remains, opens <dir> if needed, and asserts via `code --status` that
# the single window's folder IS <dir>. Deterministic (no OCR): --status
# prints "window [N] (folder)" per window.
# Why: front_window greps fullscreen OCR, and out-of-workspace tab titles
# ("a.rb — ws-stand" inside the qa-stand window) false-positive it —
# palette then runs the check with folders[0]=qa-stand while the oracle
# hunts ws-stand JSON (proven 2026-09-14: instrumented batch logged
# ROOT=qa-stand during a ws-stand case). Stale Output from other windows
# dies with them (channels are per-window host, shared name).
window_gate() {
  local tries="${2:-6}" i n title base
  base=$(basename "$1")
  for (( i = 1; i <= tries; i++ )); do
    n=$(window_count)
    if [[ "$n" == "1" ]]; then
      title=$(code --status 2>/dev/null | grep -o "window \[[0-9]*\][^$]*" | head -n 1)
      if echo "$title" | grep -qi "$base"; then
        activate
        return 0
      fi
      # Single window but the WRONG folder (e.g. base qa-stand from run.sh
      # start while the case wants ws-stand): retarget it instead of
      # close+reopen ping-pong (proven 2026-09-14: blind close killed the
      # front window, which was often the just-opened target).
      # NOTE: `code --reuse-window` does NOT retarget a live window's
      # workspaceFolders[0] (proven 2026-09-13: Doctor kept reporting
      # qa-stand). So: save-all (no save dialog can block the close),
      # close the wrong window, open the target fresh. Verified close:
      # abort loudly on failure (stuck window poisons later cases).
      save_all
      close_window || return 1
      code "$1" >/dev/null 2>&1
      sleep 10
      activate
      continue
    fi
    # Too many windows: cycle Cmd+` to the target window FIRST, then close
    # it via Close Window. Blind close_window kills the FRONT window, which
    # is often the qa-stand BASE — then `code <dir>` reopens the stand and
    # the gate ping-pongs between two survivors forever (proven 2026-09-14:
    # --reuse-window also refuses to retarget across windows, so the dead
    # window can only be closed when frontmost).
    # close_window is verified: abort loudly if it fails (a stuck window
    # poisons every later case — fail fast beats cascade red).
    cycled=0
    for (( j = 1; j <= n; j++ )); do
      shot "gate-cycle-$i-$j"
      if ocr_text | grep -qi "$base"; then
        cycled=1; break
      fi
      osa -e 'tell application "System Events" to keystroke "`" using command down'
      sleep 1
    done
    close_window || return 1
    code "$1" >/dev/null 2>&1
    sleep 8
    activate
  done
  echo "window_gate: no single $base window after $tries tries (n=$(window_count))" >&2
  return 1
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
  osa -e 'tell application "System Events" to key code 49'
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
# trust_on — grant workspace trust by opening the folder FRESH with zero
# windows open. A fresh Code launch on an untrusted folder shows the
# workspace-trust STARTUP DIALOG (not the Manage-Trust editor, which has
# no palette entry that opens it directly — proven 2026-09-14: Enter on
# "Workspaces: Manage Workspace Trust" opened a folder picker that stole
# the window). The startup dialog has a Trust button; click it via OCR.
# Precondition: caller already window_gated to the stand (front window is
# ours, palette works there). Post: trusted + Reload for ext host.
# Restored by trust_restore like trust_off. Needs assert.sh.
trust_on() {
  cp "$HOME/Library/Application Support/Code/User/settings.json" /tmp/gui-qa-settings.bak
  # Close ALL windows: the next `code <dir>` is a fresh launch that shows
  # the trust startup dialog for untrusted folders.
  palette_run "File: Close Window"
  code --status 2>/dev/null | grep -q "window \[" && palette_run "File: Close Window"
  sleep 2
  code "$1" >/dev/null 2>&1
  sleep 10
  activate
  shot "trust-dlg"
  if ocr_text | grep -qiE "Do you trust|Trust the authors|trust this folder"; then
    local xy
    xy=$(~/qa-vm-bin/vocr "$LAST_SHOT" 2>/dev/null | python3 -c "
import json,sys
d = json.load(sys.stdin)
for o in d:
    t = o['text'].strip().lower()
    if t in ('trust', 'trust folder', 'yes, i trust the authors'):
        print(f\"{int((o['x'] + o['w'] / 2) / 2)},{int((o['y'] + o['h'] / 2) / 2)}\")
        break
")
    if [[ -z "$xy" ]]; then
      echo "trust_on: dialog visible but no Trust button in $LAST_SHOT" >&2
      return 1
    fi
    cliclick c:$xy
    sleep 3
  fi
  # Already trusted: no dialog, straight to reload.
  palette_run "Reload Window"
  sleep 10
  activate
}
# trust_off / trust_restore — Workspace Trust prompt blocks palette automation
# on never-opened folders; disable around fresh_window, restore after.
# NOTE: trust_off does NOT grant trust to an already-untrusted folder (the
# key only gates the prompt) — use trust_on for that. Restored by the same
# trust_restore.
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

# mk_ws_stand — workspace-filter project (2G): lib/, spec/, gen/, rake files,
# safety-net dirs. Per-case mutations (yml, .gitignore, chmod, settings)
# happen in the case itself; every case starts by recreating the stand.
WS_STAND="/tmp/ws-stand"
mk_ws_stand() {
  rm -rf "$WS_STAND"
  mkdir -p "$WS_STAND/lib" "$WS_STAND/spec" "$WS_STAND/gen" "$WS_STAND/lib/tasks" \
    "$WS_STAND/node_modules" "$WS_STAND/vendor"
  _rbs_gemfile "$WS_STAND" 0
  cat > "$WS_STAND/lib/a.rb" <<'RUBY'
class A
  def go(x)
    x
  end
end
RUBY
  cat > "$WS_STAND/spec/b_spec.rb" <<'RUBY'
class B
  def go(x)
    x
  end
end
RUBY
  cat > "$WS_STAND/gen/c.rb" <<'RUBY'
class C
  def go(x)
    x
  end
end
RUBY
  cat > "$WS_STAND/gen/keep.rb" <<'RUBY'
class Keep
  def go(x)
    x
  end
end
RUBY
  cat > "$WS_STAND/lib/tasks/db.rake" <<'RUBY'
task :db do
  puts "db"
end
RUBY
  cat > "$WS_STAND/Rakefile" <<'RUBY'
task :default do
  puts "default"
end
RUBY
  cat > "$WS_STAND/node_modules/x.rb" <<'RUBY'
class X
  def go(x)
    x
  end
end
RUBY
  cat > "$WS_STAND/vendor/y.rb" <<'RUBY'
class Y
  def go(x)
    x
  end
end
RUBY
  _rbs_bundle "$WS_STAND" || return 1
  return 0
}
# mk_rb40_stand — Ruby 4.0 + gem 1.6.2 + live daemon project (2H.1).
# A real consumer Gemfile on the path gem (gemspec alone gives bundler no
# installable docscribe — proven 2026-09-13). Runs under rbenv 4.0.6 via
# .ruby-version. Probed: bundle install clean, docscribe 1.6.2 boots.
RB40_STAND="/tmp/rb40-stand"
mk_rb40_stand() {
  rm -rf "$RB40_STAND"
  mkdir -p "$RB40_STAND"
  cat > "$RB40_STAND/Gemfile" <<EOF
source "https://rubygems.org"
gem "docscribe", path: "$HOME/docscribe"
gem "rbs", require: false
EOF
  printf '4.0.6\n' > "$RB40_STAND/.ruby-version"
  cat > "$RB40_STAND/widget.rb" <<'RUBY'
class Widget
  # Adds two numbers.
  # @param [Integer] a first.
  # @param [Integer] b second.
  # @return [Integer] sum.
  def add(a, b)
    a + b
  end
end
RUBY
  (cd "$RB40_STAND" && RBENV_VERSION=4.0.6 rbenv exec bundle install --quiet 2>&1 | tail -n 3) \
    || return 1
  return 0
}
# mk_nogem_stand — project WITHOUT the docscribe gem (2H.7 troubleshooting).
NOGEM_STAND="/tmp/nogem-stand"
mk_nogem_stand() {
  rm -rf "$NOGEM_STAND"
  mkdir -p "$NOGEM_STAND"
  printf 'source "https://rubygems.org"\ngem "rake"\n' > "$NOGEM_STAND/Gemfile"
  printf 'def hello(name)\n  "hi"\nend\n' > "$NOGEM_STAND/foo.rb"
  (cd "$NOGEM_STAND" && bundle install --quiet >/dev/null 2>&1)
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
