#!/bin/zsh
# 2E.1: Doctor RBS auto-detect matrix, 8 sequential states in ONE project.
# Doctor resolves workspaceFolders[0] and `code -r <dir>` does not reliably
# retarget a live window (proven: Doctor kept reporting qa-stand), so states
# mutate a single fresh window. Side benefit: exercises the 2D mtime re-probe.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
MPROJ="${MPROJ:-/tmp/rbs-mproj}"
SET="$HOME/Library/Application Support/Code/User/settings.json"

# docstate <tag> <pattern> [forbidden] — Doctor + overlapping scroll-hunt.
docstate() {
  palette_run "DocScribe: Doctor"
  dochunt "$1" "$2" "${3:-}"
}

rm -rf "$MPROJ"; mkdir -p "$MPROJ"
_rbs_gemfile "$MPROJ" 0
_rbs_probe "$MPROJ"
_rbs_bundle "$MPROJ" || return 1

trust_off
trap 'trust_restore' EXIT
fresh_window_checked "$MPROJ" "rbs-mproj" || return 1
escape

# s1: only sig/
mkdir -p "$MPROJ/sig"
printf 'class Probe\n  def hello: (String name) -> String\nend\n' > "$MPROJ/sig/probe.rbs"
docstate "2e1-s1" 'RBS.? *enabled.*heuristic' \
  || { trust_restore; return 1; }

# s2: only Gemfile.lock (install with rbs, then drop the gem line; lock stays)
rm -rf "$MPROJ/sig"
echo 'gem "rbs"' >> "$MPROJ/Gemfile"
_rbs_bundle "$MPROJ" || { trust_restore; return 1; }
sed -i '' '/gem "rbs"/d' "$MPROJ/Gemfile"
palette_run "DocScribe: Doctor"
dochunt "2e1-s2" 'RBS.? *enabled.*heuristic' \
  || { trust_restore; return 1; }

# s3: only Gemfile
echo 'gem "rbs"' >> "$MPROJ/Gemfile"
_rbs_bundle "$MPROJ" || { trust_restore; return 1; }
docstate "2e1-s3" 'RBS.? *enabled.*heuristic' \
  || { trust_restore; return 1; }

# s4: explicit false + sig/ (explicit wins)
sed -i '' '/gem "rbs"/d' "$MPROJ/Gemfile"
_rbs_bundle "$MPROJ" || { trust_restore; return 1; }
mkdir -p "$MPROJ/sig"
printf 'class Probe\n  def hello: (String name) -> String\nend\n' > "$MPROJ/sig/probe.rbs"
printf 'rbs:\n  enabled: false\n' > "$MPROJ/docscribe.yml"
docstate "2e1-s4" 'RBS.? *disabled' 'heuristic' \
  || { trust_restore; return 1; }

# s5: explicit true, no sig/
rm -rf "$MPROJ/sig"
printf 'rbs:\n  enabled: true\n' > "$MPROJ/docscribe.yml"
docstate "2e1-s5" 'RBS.? *enabled.*heuristic' \
  || { trust_restore; return 1; }

# s6: collection alone — PENDING product decision, see card 523.
# Checklist reads "collection -> enabled (found)"; code today does NOT count
# hasCollection as an enable signal (shouldUseRbs: explicit/sig/lock/Gemfile),
# so Doctor says disabled. If decision (a) wins, add hasCollection to
# shouldUseRbs (+ framework test) and flip this oracle to enabled.
rm -f "$MPROJ/docscribe.yml"
cp "$HOME/docscribe/rbs_collection.lock.yaml" "$MPROJ/" 2>/dev/null \
  || touch "$MPROJ/rbs_collection.lock.yaml"
docstate "2e1-s6" 'RBS.? *disabled' 'heuristic' \
  || { trust_restore; return 1; }

# s7: empty (bare Gemfile, no signals)
rm -f "$MPROJ/rbs_collection.lock.yaml"
docstate "2e1-s7" 'RBS.? *disabled' 'heuristic' \
  || { trust_restore; return 1; }

# s8: signals present, silenced via settings (restored before assert)
echo 'gem "rbs"' >> "$MPROJ/Gemfile"
_rbs_bundle "$MPROJ" || { trust_restore; return 1; }
mkdir -p "$MPROJ/sig"
printf 'class Probe\n  def hello: (String name) -> String\nend\n' > "$MPROJ/sig/probe.rbs"
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.useRbs']=False; json.dump(d, open(p,'w'))"
docstate "2e1-s8" 'RBS.? *disabled' 'heuristic'; rc=$?
# Always restore the surgical toggle (trap covers trust only).
python3 -c "import json; b=json.load(open('/tmp/gui-qa-settings.bak')); json.dump(b, open('$SET','w'))"
[[ $rc -eq 0 ]] || return 1
return 0
