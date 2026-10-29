# Contributing to Glasscase

Thanks for helping. Glasscase is small on purpose, so a short read first.

## Ground rules

- **Free only.** No paid APIs, paid dependencies, accounts, telemetry or monetization. A key or cookie the user adds stays on their machine and is never logged in full.
- **Honest numbers.** LOWEST is the current floor. AVG is the average of actual sales over a window. Every number carries its source and window, and a fallback is always labelled as one.
- **English** for code, comments, UI text and docs.
- **Not affiliated with Valve.** Do not add Valve or Steam branding beyond plain names.
- Do not copy code or data tables from GPL-licensed projects; Glasscase is MIT.

## Setup

```bash
git clone https://github.com/OWNER/glasscase.git
cd glasscase
npm ci
npm start            # run the app
npm test             # node:test suite
xvfb-run -a npm run smoke   # Linux without a display; plain `npm run smoke` elsewhere
```

Node 22 is required. Electron is the only runtime and it comes from `devDependencies`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/core/` | Pure logic shared by both processes: parsing, pricing, fees, aggregation. Fully unit-tested. |
| `src/main/` | Electron main process: window, IPC, network, cache, scan pipeline, demo. |
| `src/renderer/` | Plain HTML, CSS and ES modules. No framework and no bundler. |
| `test/` | `node:test` suites. |
| `scripts/` | Asset rendering (icon and README hero). |

All network calls happen in the main process. The renderer runs with `contextIsolation`, no Node integration, a sandbox and a strict CSP, and reaches the main process only through `src/main/preload.cjs`.

## Pull requests

- Keep changes focused and add or update tests for anything in `src/core/`.
- Run `npm test` and the smoke run before opening the PR.
- For UI changes, attach before and after screenshots (`npm run shots` writes a full set to `assets/shots/`). If the walkthrough changes, re-record the README GIFs with `npm run gifs`.
- Update `CHANGELOG.md` under "Unreleased".
