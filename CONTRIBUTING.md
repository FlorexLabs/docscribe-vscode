# Contributing to DocScribe

We welcome contributions! Here's how to get started.

## Branching

This project follows [FlorexLabs shared workflows](https://github.com/FlorexLabs/shared-workflows):

```
feature/*  -- squash & merge -->  v*.*.*  -- merge commit -->  master
system/*   ---------------------------------------- merge commit -->  master
```

- **feature/*** — new features. Squash & merge into release branch.
- **v*.*** — release branches. Merge commit into `master`.
- **system/*** — infra/config. Merge commit directly into `master`.

## Development Setup

1. Fork and clone the repository
2. Run `npm install`
3. Open in VS Code with the extension development host (`F5`)

## Code Standards

- **TypeScript** — strict mode enabled (`noUnusedLocals`, `noUnusedParameters`)
- **ESLint** — `@typescript-eslint/strict` rules applied
- **Prettier** — run `npm run format` before committing
- All code must pass `npm run lint && npm run typecheck && npm run compile`

## Testing

- All modules should have corresponding test files in `src/test/suite/`
- Tests use Mocha (tdd UI), Sinon for stubs, and `@vscode/test-electron`
- Run `npm test` to execute tests in a headless VS Code instance

## Pull Request Process

1. Create a feature branch from the release branch
2. Make your changes with clear commit messages
3. Ensure CI passes (format:check, lint, typecheck, compile, tests)
4. Open a PR targeting the release branch
5. Squash & merge when approved

## Commit Messages

Use conventional commits or the format `[version] Description`.

## Questions?

Open a [GitHub Issue](https://github.com/FlorexLabs/docscribe-vscode/issues).
