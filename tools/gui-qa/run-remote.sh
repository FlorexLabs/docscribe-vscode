#!/bin/zsh
# Host-side entry for the GUI driver: resolve VM IP, sync tree, run.
# Idempotent launcher — no hardcoded IPs, no stale-tree runs.
# Usage: ./run-remote.sh [cases/...]   (args forwarded to run.sh)
cd "$(dirname "$0")" || exit 2
unset ALL_PROXY HTTP_PROXY HTTPS_PROXY NODE_USE_ENV_PROXY

VM="${QA_VM:-qa-vm}"
IP="$(tart ip "$VM" 2>/dev/null)"
if [[ -z "$IP" ]]; then
  echo "FATAL: VM $VM has no IP. Start it: tart run --no-graphics $VM" >&2
  exit 2
fi
echo "# vm: $VM @ $IP"
SSH=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "admin@$IP")
if ! "${SSH[@]}" 'echo VM_OK' 2>/dev/null | grep -q VM_OK; then
  echo "FATAL: ssh to admin@$IP failed." >&2
  exit 2
fi

ROOT="$(cd ../.. && pwd)"
# NOTE: `out/` MUST sync too — run.sh compiles in-VM (npm run compile) and
# compares out/ sums, so a dropped exclude silently rebuilds the vsix from
# STALE compiled JS while src/ is fresh (proven 2026-09-14: fix 555 present
# in src/, absent from installed ext, green framework + red driver).
# Trailing-slash discipline: `src` WITHOUT slash creates src/ at dest;
# `src/` WITH slash would dump its CONTENTS into dest root (proven
# 2026-09-14: that bug sprayed *.ts/*.js/cases/test across the VM repo
# root and src/ never updated — every driver run tested stale code).
# node_modules/.git/.vscode-test stay excluded; .vsix artifacts excluded.
rsync -az --exclude node_modules --exclude out --exclude .git --exclude .vscode-test \
  "$ROOT/tools/gui-qa/" "admin@$IP:~/docscribe-vscode/tools/gui-qa/" || exit 2
rsync -az --exclude node_modules --exclude .git --exclude .vscode-test --exclude '*.vsix' \
  "$ROOT/src" "$ROOT/out" "$ROOT/package.json" "admin@$IP:~/docscribe-vscode/" || exit 2
echo "# sync: tree -> VM"

"${SSH[@]}" "cd ~/docscribe-vscode/tools/gui-qa && ./run.sh $*"
