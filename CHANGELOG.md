# Changelog

## [0.1.2] — TBD

### Features

- **Capability detection** — parse `docscribe --version`, cache, derive supported features (server mode, `--rbs-collection`, exit codes) (#VC-1)
- **Server mode** — Unix socket client + JSON-RPC instead of child_process per check, auto-start/stop, fallback to CLI (#VC-2)
- **Gem missing handling** — check `bundle exec docscribe --version` once per session, show notification with "Open Gemfile" action (#VC-3)
- **Doctor diagnostic panel** — command `DocScribe: Doctor` showing Ruby SDK, Gemfile root, docscribe version, server status, last errors (#VC-5)
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
