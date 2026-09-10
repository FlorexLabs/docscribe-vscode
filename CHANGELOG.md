# Changelog

## [0.1.3] — 2026-10-10

### Features

- **RBS auto-detect** — port of RubyMine `RbsDetector`: explicit `docscribe.yml` `rbs.enabled` wins, then `sig/` RBS
  files, `Gemfile.lock`, `Gemfile`; `rbsHash` for invalidation
- **Daemon `cli_overrides`** — forward `rbs` / `rbs_collection` / `validate_types` in `check`, `check_batch` and `fix`
  RPC calls
- **`docscribe.validateTypes`** — new setting (default `true`); passes `--validate-types` / `--no-validate-types`
  (gem >= 1.6.2); `Docscribe/InvalidType` maps to Warning
- **Capability gates for 1.6.2** — `hasValidateTypes` / `hasUpdateTypesRpc`; one-time upgrade warning below 1.6.2;
  capabilities re-probed when `Gemfile.lock` changes mid-session

### Fixed

- CLI parity with RubyMine: `--rbs` (+ `--rbs-collection` when the lock exists); `safe` strategy uses aggressive flags
  when RBS is on (RBS types only update in aggressive mode)
- **File-scoped Update Types via daemon** — single-file `update_types` goes through the `update_types` RPC (`{ file }` →
  `{ status, dir, exit_code }`, gem >= 1.6.2) with CLI fallback; workspace scope stays on CLI; open documents refresh
  afterwards
- **Fix source routing in QuickFix** — daemon `changes[].source` (`rbs` | `infer` | `syntax`) threaded through adapters,
  parser and diagnostics; RBS-sourced lightbulb offers Update Types, others offer direct fix
- **Batch per-file errors surfaced** — `check_batch` `error` results become `Docscribe/Error` diagnostics instead of
  silent `error_count`
- **Workspace file filter sync** — `collectWorkspaceFiles` honors `docscribe.yml` `filter.files` (exclude wins, empty
  include = all, fallback `exclude: ['spec']`) and root `.gitignore` (with `!` negations); fixed `excludeDirs` stays as
  safety net
- **Missing-RBS balloon** — with `docscribe.useRbs` on and no `rbs` gem, a once-per-session warning offers one-click
  `gem "rbs"` append to the Gemfile
- **Doctor RBS/validate/capabilities rows** — effective RBS state, validate-types state and a full capabilities JSON
  dump, plus `validateTypes`/`useServer` in settings
- **i18n** — `package.nls.json` (EN) + `package.nls.ru.json` (RU) for command titles, setting descriptions and tool
  metadata
- **Language-model tools** — six `languageModelTools` (`check_file`, `check_workspace`, `safe_fix`, `aggressive_fix`,
  `update_types`, `doctor`) reusing the command paths; requires VSCode >= 1.90 (`engines` bumped)

## [0.1.2] — 2026-08-21

### Features

- **Capability detection** — parse `docscribe --version`, cache, derive supported features (server mode,
  `--rbs-collection`, exit codes) (#VC-1)
- **Server mode** — Unix socket client + JSON-RPC instead of child_process per check, auto-start/stop, fallback to CLI
  (#VC-2)
- **Gem missing handling** — check `bundle exec docscribe --version` once per session, show notification with "Open
  Gemfile" action (#VC-3)
- **Doctor diagnostic panel** — command `DocScribe: Doctor` showing Ruby SDK, Gemfile root, docscribe version, server
  status, last errors (#VC-5)
- **rubyPath/bundlePath settings** — custom paths for Ruby and Bundler executables (#VS-204)

### Performance

- **Per-file lock/queue** — rapid saves coalesce, cancel in-flight checks, only latest result shown (#VC-4)

### Settings

- `docscribe.rubyPath` — path to Ruby executable (default: `ruby`)
- `docscribe.bundlePath` — path to Bundler executable (default: `bundle`)

## [0.1.1] — 2026-07-02

### Added

- `updateTypes` command for RBS-based type inference
- `omitBoilerplate` setting (`-B` flag)
- Folding range provider for YARD comment blocks
- `foldComments` setting for auto-collapse on file open
- Status bar item showing last check result
- `ignorePatterns` setting for file exclusion
- Progress indicator during auto-diagnostics
- Test fixtures (`.rb`, `.rake`, `Gemfile`, JSON outputs)

### Fixed

- Activation events: `onLanguage:ruby` + `onLanguage:rake` (was `onStartupFinished`)
- Ruby editor integration: keybindings (`cmd+shift+d`), context menu, `.rake` support
- README badges, CI badge, license badge

## [0.1.0] — 2026-06-27

### Added

- Initial release
- Auto-diagnostics on save/open with JSON output (docscribe ≥ 1.5.0)
- Code actions (lightbulb) with per-diagnostic fix and fix-all
- Commands: Check File, Check Workspace, Safe Fix, Aggressive Fix
- Settings: `commandPath`, `useBundleExec`, `runOnSave`, `useRbs`
- CI matrix (Node 18–26 × VSCode stable/insiders)
- Release workflow (VSIX build + GitHub Release)
