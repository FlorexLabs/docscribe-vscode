#!/bin/zsh
# Screenshot + Vision OCR assertions. Screenshots stay files; only text is asserted.
VOCR="${VOCR:-$HOME/qa-vm-bin/vocr}"
SHOT_DIR="${SHOT_DIR:-/tmp/gui-qa}"
mkdir -p "$SHOT_DIR"
LAST_SHOT=""

shot() {
  LAST_SHOT="$SHOT_DIR/$1.png"
  screencapture -x "$LAST_SHOT"
}

ocr_text() {
  "$VOCR" --text-only "$LAST_SHOT" 2>/dev/null
}

ocr_json() {
  "$VOCR" "$LAST_SHOT" 2>/dev/null
}

# assert_ocr <shot-name> <grep-pattern> — screenshots then greps OCR text.
assert_ocr() {
  shot "$1"
  if ocr_text | grep -qiE "$2"; then
    return 0
  fi
  echo "OCR miss for /$2/ in $LAST_SHOT" >&2
  return 1
}

# assert_ocr_retry <shot-name> <grep-pattern> [tries=3] — screenshot+grep with settle waits.
assert_ocr_retry() {
  local tries="${3:-3}" i
  for (( i = 1; i <= tries; i++ )); do
    shot "$1"
    if ocr_text | grep -qiE "$2"; then
      return 0
    fi
    sleep 4
  done
  echo "OCR miss for /$2/ in $LAST_SHOT after $tries tries" >&2
  return 1
}
# fresh_window_checked <dir> <title-pattern> [tries=3] — fresh_window + verify
# the FRONT window is ours. pkill clean slate + hot-exit restore can leave a
# stale stand window beside the qa-stand base; plain fresh_window then closes
# the wrong one and later `code --reuse-window` lands files in qa-stand
# (proven 2026-09-13: 2e5 Problems showed clean.rb). Needs actions.sh sourced.
fresh_window_checked() {
  local tries="${3:-3}" i
  for (( i = 1; i <= tries; i++ )); do
    fresh_window "$1" || return 1
    shot "front-check-$i"
    if ocr_text | grep -qi "$2"; then
      return 0
    fi
    sleep 2
  done
  echo "front window is not /$2/ after $tries tries" >&2; return 1
}
# panel_grep <shot-png> <pattern> [panel=Problems] — grep OCR text confined
# to the panel area below the panel tab header. Closing editor tabs via
# Cmd+W is dead in this VM (proven 2026-09-13: keystroke ignored even with
# editor focus), so absence/presence oracles must not see fullscreen editor
# source text. Anchors on the panel tab (bottom area), not fixed pixels.
panel_grep() {
  local png="$1" pattern="$2" header="${3:-Problems}"
  ~/qa-vm-bin/vocr "$png" 2>/dev/null | python3 -c "
import json,sys,re
d = json.load(sys.stdin)
tabs = {'problems', 'output', 'debug console', 'terminal', 'test results'}
tops = [o['y'] for o in d if o['text'].strip().lower() in tabs]
if not tops:
    sys.exit(2)
anchor = max(tops)
hits = [o['text'] for o in d if o['y'] > anchor and re.search(r'''$pattern''', o['text'], re.I)]
print('\n'.join(hits))
sys.exit(0 if hits else 1)
"
}
# dochunt <tag> <pattern> [forbidden] [max=12] — walk the Output panel down
# from the top with overlapping down-arrow steps (page steps can straddle a
# 1-line target exactly on the viewport boundary). Needs actions.sh sourced.
dochunt() {
  local max="${4:-12}" i
  pageup 8
  for (( i = 1; i <= max; i++ )); do
    shot "$1-p$i"
    if ocr_text | grep -qiE "$2"; then
      if [[ -n "${3:-}" ]] && ocr_text | grep -qiE "$3"; then
        echo "forbidden /$3/ visible ($1)" >&2; return 1
      fi
      return 0
    fi
    down 3
  done
  echo "OCR miss for /$2/ ($1)" >&2; return 1
}
assert_md5_same() {
  local actual
  actual=$(md5 -q "$1")
  if [[ "$actual" == "$2" ]]; then
    return 0
  fi
  echo "md5 changed for $1: $actual != $2" >&2
  return 1
}

# log_mark <logfile> — size+hash fingerprint (mtime lies: 1s granularity;
# identical reruns append identical bytes, so hash alone also lies).
log_mark() {
  stat -f "%z" "$1"
  tail -c 300 "$1" | md5
}
docscribe_log() {
  # Newest DocScribe exthost log across ALL windows/sessions. The old
  # window1-only glob went blind in fresh_window cases (window2+), watching
  # a stale log while the check ran elsewhere. Sequential runs keep all
  # other windows idle, so newest == current window.
  setopt localoptions nullglob
  local matches=("$HOME/Library/Application Support/Code/logs/"*/window*/exthost/output_logging_*/1-DocScribe.log(om[1]))
  [[ -n "$matches[1]" ]] && print -r -- "$matches[1]"
}
