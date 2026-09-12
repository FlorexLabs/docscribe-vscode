# GUI driver (Tart VM, no LLM in the loop)

Runs inside the macOS VM. Output is RSpec-style, exit code = failure count.

```sh
cd ~/docscribe-vscode/tools/gui-qa
./run.sh            # all cases
./run.sh cases/2b7.sh
```

## Laws (see ~/qa-vm/GUI_DRIVER_GUIDE.md)
- Commands via palette plain text only (`palette "DocScribe: Check current file"`).
- Menu via `shift_f10`, goto via `ctrl_g <line>`, dismiss via `escape`.
- FORBIDDEN: bare coordinate clicks, modifier+symbol keystrokes (`Ctrl+.` never fires via osascript).
- Assertions via `assert_ocr <grep-pattern>`; screenshots file-only (`/tmp/gui-qa/`), PNG kept only on failure.
- Env: `VOCR` (default `$HOME/qa-vm-bin/vocr`), `STAND` (default `$HOME/qa-stand`).

## Case contract
Each `cases/<id>.sh` sources `actions.sh` + `assert.sh`, ends with `pass <id>` or `fail <id> <why>`.
`run.sh` prints `ok <id>` / `not ok <id> <why>` lines.
