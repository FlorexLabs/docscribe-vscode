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
rsync -az --exclude node_modules --exclude out --exclude .git --exclude .vscode-test \
  "$ROOT/tools/gui-qa/" "admin@$IP:~/docscribe-vscode/tools/gui-qa/" || exit 2
rsync -az --exclude node_modules --exclude out --exclude .git --exclude .vscode-test \
  "$ROOT/src/" "admin@$IP:~/docscribe-vscode/src/" || exit 2
echo "# sync: tree -> VM"

"${SSH[@]}" "cd ~/docscribe-vscode/tools/gui-qa && ./run.sh $*"
