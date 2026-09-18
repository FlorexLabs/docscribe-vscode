# Tests

Suites live in `suite/*.test.ts` (TDD `suite`/`test`, Node `assert`) and run
inside the Extension Development Host via `@vscode/test-electron`:

```bash
npm test        # compile (pretest) + launch headed VS Code + mocha
npm run compile # typecheck + emit to out/ (no display needed)
npm run lint    # eslint src/
```

## Headed local run

`npm test` launches a real (headed) VS Code window. It needs a display and window focus — headless SSH/CI without a
display fails for environmental reasons (missing display/Xvfb), not code reasons. If `npm test` cannot open the host,
still run `npm run compile` and `npm run lint` to validate.

Display/focus caveats:

- macOS: keep the host window focused; Spaces/Stage Manager jumps can flake focus-dependent tests (`showTextDocument`,
  diagnostics wait).
- Linux CI: wrap with `xvfb-run -a npm test`.
- Long suites: integration tests wait up to 150s for diagnostics; do not background the host mid-run.
- Failure screenshots: on any test failure the root hook (`suite/failureScreenshots.ts`, registered in `suite/index.ts`)
  runs `screencapture -x` on macOS only (no-op elsewhere), writes `test-results/<timestamp>_<test>.png` (gitignored),
  and prints `[failure-screenshot] <path>`. Grant Screen Recording permission on first use; screenshots capture the
  whole display, so avoid secrets on screen during runs.
