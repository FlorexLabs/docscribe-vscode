# Docscribe

**DocScribe** is a VS Code extension that auto-generates inline YARD documentation for Ruby methods
using [docscribe](https://github.com/unurgunite/docscribe) — a Ruby gem that analyzes AST and suggests YARD-compatible
documentation.

## Features

- **Diagnostics** — highlights undocumented methods directly in the editor
- **Code Actions** — quick-fix lightbulb to generate YARD documentation with one click
- **Workspace-wide check** — scan all Ruby files in the project
- **Flexible strategies** — safe (document missing methods) and aggressive (replace existing docs)
- **Explain mode** — see exactly what docscribe recommends before applying
- **Configurable** — bundle exec support, custom command path, run on save

## Requirements

- **Ruby** (>= 3.0) with Bundler
- **docscribe gem** installed globally or in your Gemfile

Install the gem:

```bash
gem install docscribe
```

Or add to your Gemfile:

```ruby
gem "docscribe", group: :development
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

Open a Ruby file — undocumented methods are underlined with a warning. Hover to see what's missing.

### Code Actions

Click the lightbulb (or press `Cmd+.` / `Ctrl+.`) on an undocumented method and select **Generate YARD documentation**.

### Settings

| Setting                   | Default     | Description                          |
|---------------------------|-------------|--------------------------------------|
| `docscribe.commandPath`   | `docscribe` | Path to the docscribe executable     |
| `docscribe.useBundleExec` | `true`      | Use `bundle exec docscribe`          |
| `docscribe.runOnSave`     | `false`     | Run check automatically on file save |

## Extension Settings

This extension contributes the following settings:

* `docscribe.commandPath`: path to the docscribe executable (overrides `bundle exec`)
* `docscribe.useBundleExec`: whether to use `bundle exec` to run docscribe
* `docscribe.runOnSave`: automatically check the current file on save

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

| Script              | Description               |
|---------------------|---------------------------|
| `npm run compile`   | Compile TypeScript        |
| `npm run watch`     | Watch mode                |
| `npm run lint`      | Run ESLint                |
| `npm run format`    | Format code with Prettier |
| `npm run typecheck` | TypeScript type checking  |
| `npm test`          | Run extension tests       |

### Testing

Tests use `@vscode/test-electron` with Mocha and Sinon. They run in a headless VS Code instance.

```bash
npm test
```

## CI

The CI pipeline runs on push and pull requests:

```
format:check -> lint -> typecheck -> compile -> test (12 matrix) -> package
```

Matrix: Node.js 18, 20, 22, 24, 25, 26 × VS Code stable, insiders.

## License

[MIT](./LICENSE.txt)
