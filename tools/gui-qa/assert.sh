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
# panel_top <tag> [header] — scroll a panel to its top.
# `pageup N` from an unknown offset does NOT guarantee the top (proven
# 2026-09-13: 2h4 hunted from mid-report and looped the bottom half
# forever, hanging the whole run). Scroll until HEADER is visible, then
# stop. Default header matches Doctor/Problems/Output generically; pass
# an explicit one when the panel content is JSON without headers
# (proven 2026-09-14: workspace JSON has no "Output" word in-viewport).
# No pixel/text equality: live badges and the clock repaint every shot
# (proven 2026-09-14: 3 identical-viewport shots, 3 different md5s).
# Best-effort: always returns 0.
panel_top() {
  local i header="${2:-DocScribe Doctor|DocScribe version|^Problems$|^Output$}"
  for (( i = 1; i <= 15; i++ )); do
    shot "$1-$i"
    if ocr_text | grep -qiE "$header"; then
      return 0
    fi
    pageup 2
  done
  return 0
}
# panelhunt <tag> <pattern> [max=12] — dochunt confined to the panel area.
# dochunt greps fullscreen (explorer/tab titles false-green, proven 2c8);
# panelhunt greps below the panel tab row only. Needs actions.sh sourced.
panelhunt() {
  local max="${3:-12}" i
  panel_top "$1-top"
  for (( i = 1; i <= max; i++ )); do
    shot "$1-p$i"
    if panel_grep "$LAST_SHOT" "$2"; then
      return 0
    fi
    down 3
  done
  echo "panel miss for /$2/ ($1)" >&2; return 1
}
# pathhunt <tag> <stem> [max=12] — panelhunt for a workspace JSON path.
# Workspace Output wraps paths across OCR lines ("lib/a." + "rb", "tasks/db."
# + "rake") and the anchor word ("ws-stand") sits lines above the tail, so
# a single grep for "lib/a" NEVER matches (proven 2026-09-14: 2g2-2g6 red
# while the files were present). Splits the stem on "/" and requires every
# segment to appear in the SAME viewport (order-insensitive within a shot:
# segments of one path always co-occur on screen). The JSON metadata header
# ("docscribe_version") pins the top instead of the generic panel words.
# Needs actions.sh sourced.
pathhunt() {
  local max="${3:-12}" i seg ok
  panel_top "$1-top" "docscribe_version"
  for (( i = 1; i <= max; i++ )); do
    shot "$1-p$i"
    ok=1
    for seg in $(echo "$2" | tr '/' ' '); do
      if ! panel_grep "$LAST_SHOT" "$seg" >/dev/null 2>&1; then
        ok=0; break
      fi
    done
    if [[ $ok -eq 1 ]]; then
      return 0
    fi
    down 3
  done
  echo "path miss for /$2/ ($1)" >&2; return 1
}
# path_absent <tag> <stem> [max=12] — panel_absent for a workspace JSON path.
# Same wrap/fragmentation problem as pathhunt: a forbidden single-grep for
# "spec/b_spec" never fires even when the file IS present split across two
# lines ("spec/" + "b_spec"), so leaks pass silently (proven 2026-09-14:
# 2g-absence oracles were vacuous).
# Fails only on a REAL reassembly: strip every non-alphanumeric char from
# the panel text below the tab anchor and search the joined CLASSNAME +
# EXTENSION ("genc", "b_spec" -> "bspec"). Single letters can no longer
# false-fire: "gen"+ANY "c" matched inside gen/keep.rb's own row (proven
# 2026-09-14: 2g3-a1 fired on keep.rb + "convention"[c] 3 lines apart),
# while "genc" only matches a literal gen/c.rb path. Underscores survive
# (spec/b_spec); dots/dashes/slashes are dropped on both sides.
# Needs actions.sh sourced.
path_absent() {
  local max="${3:-12}" i
  panel_top "$1-top" "docscribe_version"
  for (( i = 1; i <= max; i++ )); do
    shot "$1-a$i"
    if ~/qa-vm-bin/vocr "$LAST_SHOT" 2>/dev/null | python3 -c "
import json,sys,re
d = json.load(sys.stdin)
tabs = {'problems', 'output', 'debug console', 'terminal', 'test results'}
tops = [o['y'] for o in d if o['text'].strip().lower() in tabs]
if not tops:
    sys.exit(2)
anchor = max(tops)
text = ' '.join(o['text'] for o in d if o['y'] > anchor)
flat = re.sub(r'[^a-z0-9_]', '', text.lower())
want = re.sub(r'[^a-z0-9_]', '', '''$2'''.lower())
sys.exit(0 if want and want in flat else 1)
"; then
      echo "forbidden /$2/ visible ($1-a$i)" >&2; return 1
    fi
    down 3
  done
  return 0
}
# panel_absent <tag> <pattern> [max=12] — legacy single-pattern absence.
# Prefer path_absent for workspace paths (segment-split-proof).
panel_absent() {
  local max="${3:-12}" i rc
  panel_top "$1-top"
  for (( i = 1; i <= max; i++ )); do
    shot "$1-a$i"
    panel_grep "$LAST_SHOT" "$2"
    rc=$?
    if [[ $rc -eq 0 ]]; then
      echo "forbidden /$2/ visible ($1-a$i)" >&2; return 1
    fi
    if [[ $rc -eq 2 ]]; then
      echo "no panel tabs in $1-a$i" >&2; return 2
    fi
    down 3
  done
  return 0
}
# dochunt <tag> <pattern> [forbidden] [max=12] — walk the Output panel down
# from the top with overlapping down-arrow steps (page steps can straddle a
# 1-line target exactly on the viewport boundary). Needs actions.sh sourced.
dochunt() {
  local max="${4:-12}" i
  panel_top "$1-top"
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
