# Contributing to Tag Visibility

Thanks for your interest in improving Tag Visibility. This guide covers setup, the verification gate, and the rules that keep the plugin safe to ship. Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## The one rule that governs everything

Tag Visibility is **display-only**. It decorates how tags render by toggling CSS classes on existing DOM nodes; it must **never** edit note content, and it makes no network requests. Any change that could modify the vault's notes, exfiltrate data, or leave effects behind after the plugin is disabled is out of bounds. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains why this constraint shapes the whole codebase.

## Prerequisites

- **Node** - the version pinned in [`.nvmrc`](.nvmrc) (currently 20). `nvm use` picks it up.
- **npm** - install with `npm ci` (the repo uses `package-lock.json`).

## Setup

1. Fork the repository.
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/obsidian-tag-visibility.git`
3. Install dependencies: `npm ci`

## Build artifacts

`main.js` is **not committed** - it is gitignored and built by esbuild from `src/` (shipped via the release workflow). `styles.css`, by contrast, is hand-authored source and **is** committed; you edit it directly.

| Command | What it does |
|---|---|
| `npm run dev` | esbuild in watch mode (rebuilds `main.js` on save) |
| `npm run build` | one production build of `main.js` |
| `npm run lint` | ESLint over `src` and `tests` (`--max-warnings 0`, no exempted files) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |

## Testing your change in Obsidian

1. `npm run build` (or leave `npm run dev` running).
2. Copy `main.js`, `manifest.json`, and `styles.css` into your test vault at `.obsidian/plugins/tag-visibility/` (the folder matches the manifest `id`).
3. Do a **full app reload** (`Ctrl+R` / `Cmd+R`). A plugin off/on toggle does not refresh injected CSS, so a CSS change needs a full reload.

For an install-from-GitHub loop, [BRAT](https://github.com/TfTHacker/obsidian42-brat) works against tagged releases.

## The verification gate

CI (`.github/workflows/build.yml`) runs the full chain on **every branch push** and every PR to `main`:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

**A PR must be green on all four.** Run them locally before pushing. Tests use Vitest; the observer tests run under `happy-dom` (see `tests/observerBase.test.ts` for the recycling-aware pattern). New behavior needs a test; a bug fix needs a regression test.

The full pipeline, including how releases are cut and verified, is documented in [docs/CI.md](docs/CI.md).

## Coding conventions

- **Styling lives in `styles.css`**, never hardcoded in JS. Use Obsidian theme variables (`var(--text-muted)`, etc.) so themes and snippets can restyle the plugin. Only dynamic geometry (transforms, computed positions, CSS custom properties) is set from JS.
- **Build DOM with `createEl` / `createDiv` / `createSpan`**, never `innerHTML` / `outerHTML` / `insertAdjacentHTML`.
- **Register everything that needs cleanup** via `registerEvent`, `registerDomEvent`, `addCommand`, or `plugin.register(...)`. The observer base already does this; follow the pattern.
- **Keep the engine pure.** Code under `src/engine/` must not touch the DOM or Obsidian UI; it takes tags, metadata, rules, and overrides and returns decisions.
- **Console output is errors only.** No `console.log`; reserve `console.error` for genuine errors.
- **UI text is Sentence case**, and command names do not include the plugin name (Obsidian prefixes them).
- **Accessibility:** interactive controls need a keyboard path (focusable, Enter/Space activation), not just a click handler.

## Commits and pull requests

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

Optional body explaining the change in detail.
```

Valid types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `ci`, `test`. Fill out the pull request template, reference any related ADR in `docs/decisions/`, and keep PRs focused (one logical change is easier to review and revert).

## Reporting bugs and security issues

- **Bugs and feature requests**: open an issue using the [templates](.github/ISSUE_TEMPLATE).
- **Security vulnerabilities**: do not open a public issue. See [SECURITY.md](SECURITY.md).

## Architecture and docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - the canonical layered design (observers, engine, storage), visibility resolution, and how decoration is applied and reversed.
- [docs/TESTING.md](docs/TESTING.md) - the QA smoke matrix and manual test plan.
- [docs/CI.md](docs/CI.md) - the CI workflows, the verification gate, and the release pipeline.
