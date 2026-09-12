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
  if ocr_text | grep -qi "$2"; then
    return 0
  fi
  echo "OCR miss for /$2/ in $LAST_SHOT" >&2
  return 1
}

# assert_md5_same <file> <expected-md5>
assert_md5_same() {
  local actual
  actual=$(md5 -q "$1")
  if [[ "$actual" == "$2" ]]; then
    return 0
  fi
  echo "md5 changed for $1: $actual != $2" >&2
  return 1
}

# log_tail <DocScribe-log-glob> — newest 1-DocScribe.log tail.
docscribe_log() {
  ls -t "$HOME"/Library/Application\ Support/Code/logs/*/window1/exthost/output_logging_*/1-DocScribe.log 2>/dev/null | head -n 1
}
