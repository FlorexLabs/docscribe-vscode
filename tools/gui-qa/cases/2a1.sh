#!/bin/zsh
# 2A.1: extension installed from VSIX, version matches (shell oracle, no GUI).
ver=$(code --list-extensions --show-versions 2>/dev/null | grep -i "docscribe" | head -n 1)
echo "$ver" | grep -q "0.1.3" || { echo "extension 0.1.3 not installed: $ver" >&2; return 1; }
return 0
