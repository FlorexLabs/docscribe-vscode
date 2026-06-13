# DocScribe

**DocScribe** is a VS Code extension that auto-generates inline YARD documentation for Ruby methods
using [docscribe](https://github.com/unurgunite/docscribe) — a Ruby gem that analyzes AST and suggests YARD-compatible
documentation.

## Features

- **Diagnostics** — undocumented methods highlighted directly in the editor on file open or save
- **Code Actions** — lightbulb quick-fix to generate YARD documentation with one click
- **RBS type inference** — uses RBS signatures for accurate `@param` and `@return` types (when `gem "rbs"` is in your
  Gemfile)
- **Workspace-wide check** — scan all Ruby files in the project
- **Flexible strategies** — safe (document missing methods only) and aggressive (replace existing docs)
- **Configurable** — bundle exec, custom command path, run on save, RBS toggle

## Requirements

- **Ruby** (>= 3.0) with Bundler
- **docscribe gem** installed globally or in your Gemfile

```bash
gem install docscribe
```

Or add to your Gemfile:

```ruby
gem "docscribe", group: :development
```

For RBS type inference:

```ruby
gem "rbs", group: :development
```

## Usage

### Commands

| Command                                             | Description                                           |
|-----------------------------------------------------|-------------------------------------------------------|
| `DocScribe: Check current file`                     | Analyze the active Ruby file for undocumented methods |
| `DocScribe: Check entire workspace`                 | Scan all Ruby files in the project                    |
| `DocScribe: Apply safe fixes to current file`       | Add docs to undocumented methods only                 |
| `DocScribe: Apply aggressive fixes to current file` | Replace all existing YARD docs                        |

### Diagnostics

Open a Ruby file — undocumented methods are underlined with a warning. Hover to see what's missing. Diagnostics update
automatically on file save and open.

### Code Actions

Click the lightbulb (or press `Cmd+.` / `Ctrl+.`) on an undocumented method and select a fix.

### Settings

| Setting                   | Default     | Description                                          |
|---------------------------|-------------|------------------------------------------------------|
| `docscribe.commandPath`   | `docscribe` | Path to the docscribe executable                     |
| `docscribe.useBundleExec` | `true`      | Use `bundle exec docscribe`                          |
| `docscribe.runOnSave`     | `true`      | Check automatically on file save and open            |
| `docscribe.useRbs`        | `true`      | Use RBS signatures for type inference when available |

## Development

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
git clone https://github.com/FlorexLabs/docscribe-vscode.git
cd docscribe-vscode
npm install
```

### Scripts

| Script                 | Description                         |
|------------------------|-------------------------------------|
| `npm run compile`      | Compile TypeScript                  |
| `npm run watch`        | Watch mode                          |
| `npm run lint`         | Run ESLint                          |
| `npm run format`       | Format code with Prettier           |
| `npm run format:check` | Check formatting without writing    |
| `npm run typecheck`    | TypeScript type checking            |
| `npm test`             | Run extension tests                 |
| `npm run docs`         | Generate TypeDoc HTML documentation |
| `npm run prepare`      | Install git hooks (husky)           |

### Testing

Tests use `@vscode/test-electron` with Mocha and Sinon. They run in a headless VS Code instance.

```bash
npm test
```

### Documentation

TypeDoc generates HTML documentation from TSDoc comments:

```bash
npm run docs
```

Output goes to the `docs/` directory.

## CI

The CI pipeline runs on push and pull requests:

```
format:check -> lint -> typecheck -> compile -> test (12 matrix) -> package
```

Matrix: Node.js 18, 20, 22, 24, 25, 26 × VS Code stable, insiders.

### Release workflow

On tag push (`v*`) or via `workflow_dispatch`, the release workflow:

1. Runs all checks and tests
2. Packages the extension as `.vsix`
3. Creates a GitHub Release with the VSIX artifact

Download the VSIX from the release and manually upload to
the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage).

## Project Structure

```
src/
  extension.ts           Extension entry point — activates commands and providers
  docscribeRunner.ts     CLI wrapper — runs docscribe with configurable args
  diagnosticProvider.ts  Diagnostics engine — parses docscribe output, creates editor diagnostics
  codeActionProvider.ts  Code action provider — lightbulb fix and apply logic
  execAsync.ts           Child process wrapper — re-exports execFile for testability
```

## License

[MIT](./LICENSE.txt)
