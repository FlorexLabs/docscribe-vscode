# GUI driver (Tart VM, no LLM in the loop)

Host entry (resolves VM IP, syncs tree, runs; the only command you need):

```sh
./run-remote.sh            # all cases
./run-remote.sh cases/2b7.sh
```

`run.sh` runs inside the VM (also directly via ssh). It is idempotent:
pre-run wipe of session storage, settings baseline snapshot + restore,
vsix autobuild on drift, 1-window gate, per-run log in `/tmp/gui-qa/`.

## Laws (see ~/qa-vm/GUI_DRIVER_GUIDE.md)

- Commands via palette plain text only (`palette "DocScribe: Check current file"`).
- Menu via `shift_f10`, goto via `ctrl_g <line>`, dismiss via `escape`.
- FORBIDDEN: bare coordinate clicks, modifier+symbol keystrokes (`Ctrl+.` never fires via osascript).
- FORBIDDEN: single-letter Cmd+keystrokes (`Cmd+S/W`, `Cmd+Shift+W` are ignored in this VM) — use `save` (palette),
  `touch_check`, `panel_grep`; never depend on closed tabs.
- After every `fresh_window`: `fresh_window_checked` + `front_window` (stray windows steal `--reuse-window` targets).
- Settings toggles: always `trap ... EXIT` + surgical restore (an interrupt must not leak into the next case/run).
- Assertions via `assert_ocr <grep-pattern>`; screenshots file-only (`/tmp/gui-qa/`), PNG kept only on failure.
- Panel-confined oracles (`panel_grep`) wherever fixture text could match the pattern (tab titles false-green fullscreen
  greps).
- Env: `VOCR` (default `$HOME/qa-vm-bin/vocr`), `STAND` (default `$HOME/qa-stand`).

## Case contract

Each `cases/<id>.sh` sources `actions.sh` + `assert.sh`, ends with `pass <id>` or `fail <id> <why>`.
`run.sh` prints `ok <id>` / `not ok <id> <why>` lines.
