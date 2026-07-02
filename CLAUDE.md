# Claude Code Instructions

## Project Context

- **obsidian-tag-visibility** - Vault-wide tag visibility engine for Obsidian (display-only, file-safe, fully reversible)
- Created: 2026-05-04

## Repository Structure

- `src/engine/` - pure rule engine (matchers, presets, resolution); never touches the DOM
- `src/observers/` - MutationObserver-based decorators for the tag pane, Properties, autocomplete, and Notebook Navigator
- `src/storage/` - `data.json` settings (schema-versioned, migrated) and the `tags.json` metadata sidecar
- `src/ui/` - settings tab, rule editor, the Tag Visibility pane (curationWorkspace), banners, modals
- `tests/` - Vitest suite (obsidian API stubbed via `tests/_stubs/obsidian.ts`)
- `docs/` - public docs: ARCHITECTURE, DESIGN, HOW-IT-WORKS, TESTING, CI, decisions/ (MADR v4 ADRs)
- `styles.css` - tracked source (all styling); `main.js` - gitignored build artifact

## Rules

- Use conventional commits for commit messages (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`)
- Never commit secrets, credentials, or `.env` files
- Prefer editing existing files over creating new ones
- **Display-only invariant**: never add code that writes note content or makes network requests; the only persistence is `saveData` (data.json) and the plugin-folder sidecar (tags.json)

## Conventions

- Styling in `styles.css` via classes; only dynamic geometry from JS. No `innerHTML`.
- Register all cleanup via `registerEvent` / `plugin.register(...)`; observers follow `observerBase.ts`
- UI text is sentence case; command names exclude the plugin name
- Console output is errors/warnings only, prefixed `[tag-visibility]`
- See CONTRIBUTING.md for the full conventions list

## Testing

- `npm test` runs the full Vitest suite once; `npm run test:watch` for watch mode
- New behavior needs a test; a bug fix needs a regression test (cite the finding id, e.g. DA-01, in the test name or comment when one exists)
- Observer/DOM tests run under happy-dom with `// @vitest-environment happy-dom` and a stubbed `requestAnimationFrame`
- The manual release gate is the smoke matrix in `docs/TESTING.md` (sections A-H)

## Development

- `npm ci` to install; Node version from `.nvmrc`
- `npm run dev` (esbuild watch) or `npm run build` (production `main.js`)
- Full local gate before pushing: `npm run lint && npm run typecheck && npm test && npm run build`
- CI and release mechanics: `docs/CI.md` (branch CI on every push; releases cut with `npm version <x.y.z>` then pushing the bare tag)
