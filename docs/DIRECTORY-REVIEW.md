# Community directory review: findings and resolutions

The record of every issue raised by the Obsidian community directory's automated review of Tag Visibility, and what was done about each. The plugin was submitted on 2026-07-18 via the directory portal at community.obsidian.md (the portal reviews the release whose tag matches `manifest.json` at the repository HEAD; feedback is addressed by publishing a new release with an incremented version).

Findings carry `DR-` ids in the style of this project's other audit trails (`DA-`, `B-`), so tests, commits, and docs can cite them precisely.

**Status: all findings dispositioned as of 1.0.2, and confirmed by the portal's re-review of 1.0.2** (2026-07-18): the re-run raised no Errors and no new findings; it lists exactly the seven items recorded here as kept (DR-04, DR-13, DR-14, DR-15, DR-16) or deferred (DR-11, which spans the `getSettingDefinitions` warning and the `display()` deprecation notices). Fixed items name the release and commit that resolved them. Kept items are deliberate, with the reasoning recorded here. The remaining advisories are expected to persist: DR-11 clears when backlog item B018 ships, and the keeps stand unless the supported-version floor changes.

## Round 1: version 1.0.0 (one Error, blocking)

| Id | Finding | Disposition |
|----|---------|-------------|
| DR-01 | **Manifest description must not include the word "Obsidian"** (`manifest.json:6`). The validator treats the product name as redundant inside the plugin directory. Notably, this rule appears nowhere in the written submission requirements; it is enforced only by the live validator. | **Fixed in 1.0.1** (`e2df73f`). Description reworded to name the four surfaces instead of the app: "Hide, flag, or always-show any tag across the tag pane, Properties, autocomplete, and Notebook Navigator. Display-only, file-safe, fully reversible." `package.json` was aligned to the same canonical wording (it still carried an older phrasing). |

## Round 2: version 1.0.1 (Warnings and Recommendations, non-blocking)

### Releases

| Id | Finding | Disposition |
|----|---------|-------------|
| DR-02 | **Missing GitHub artifact attestations** for `main.js` and `styles.css`. | **Fixed in 1.0.2** (`5bcb5a6`). `release.yml` now runs `actions/attest-build-provenance` (pinned to a commit SHA, like the release action) over both files. Verified end to end: `gh attestation verify main.js -R prisant-labs/obsidian-tag-visibility` passes against the published 1.0.2 asset. |
| DR-03 | **Release contains an unsupported extra file** (`versions.json`); Obsidian does not download it from releases. | **Fixed in 1.0.2** (`5bcb5a6`). `versions.json` is no longer attached to releases. The file stays tracked in the repository, which is where Obsidian consults it; CI still verifies it exists at every tag. |

### Behavior

| Id | Finding | Disposition |
|----|---------|-------------|
| DR-04 | **Vault enumeration**: the plugin lists all files in the vault (`vault.getFiles`, `getMarkdownFiles`). | **As designed, with disclosure added in 1.0.2** (`5bcb5a6`). Building the vault-wide tag index is the product's core function. The README's Safety contract now states exactly what the scan touches: file paths and each file's entry in Obsidian's metadata cache. Note contents are never read; the only file the plugin reads is its own `tags.json` sidecar. The display-only invariant (no note writes, no network) is enforced by a CI test on every build. |

### Source code

| Id | Finding | Disposition |
|----|---------|-------------|
| DR-05 | **`builtin-modules` package should be replaced** (`package.json`). | **Fixed in 1.0.2** (`5bcb5a6`). The esbuild config now takes the builtin list from Node's own `node:module` (`builtinModules`); the dev dependency is removed. |
| DR-06 | **Floating promises** (`main.ts`, `tagPaneObserver.ts`, `openBeside.ts`, five sites). | **Fixed in 1.0.2** (`5bcb5a6`). The four `workspace.revealLeaf` calls are awaited; the deferred tag-pane load is explicitly `void`, and its local type now truthfully declares that `loadIfDeferred` returns a Promise. |
| DR-07 | **Bare `requestAnimationFrame`** breaks popout-window compatibility (`observerBase.ts:116`). | **Fixed in 1.0.2** (`5bcb5a6`). The observer frame scheduler calls `window.requestAnimationFrame`. |
| DR-08 | **Unnecessary type assertions** (`settings.ts`, `tagTable.ts`, three sites). | **Fixed in 1.0.2** (`5bcb5a6`). Assertions removed; the typecheck confirms they were redundant. The `querySelector` cast became a type parameter. |
| DR-09 | **Unsafe `any` assignment and argument** in frontmatter tag handling (`tagMeta.ts:180,183`). | **Fixed in 1.0.2** (`5bcb5a6`). Frontmatter values are treated as `unknown` with real type guards. Side benefit: a non-string frontmatter tag (for example a bare numeric `2024`) is now coerced to a string when indexed instead of being stored raw into a string set. |
| DR-10 | **Bare `setTimeout` / `clearTimeout`** break popout-window compatibility (`tagMeta.ts`, three sites). | **Fixed in 1.0.2** (`5bcb5a6`). The sidecar save debounce uses `window.setTimeout` / `window.clearTimeout`; the tagMeta test suite moved to the happy-dom environment so `window` exists under test. |
| DR-11 | **`PluginSettingTab` does not implement `getSettingDefinitions()`**; `display()` is deprecated since Obsidian 1.13.0, and without the declarative API the plugin's settings do not appear in the settings search on 1.13+. | **Deferred, tracked as backlog item B018, targeted at the 1.1 cycle.** This is a structural rework of the seven-tab settings surface (eight `display()` sites), not a mechanical swap. Nothing is broken today: the plugin's floor is `minAppVersion 1.9.10`, where `display()` is fully supported. The settings-search payoff on 1.13+ is real and is why the item is tracked rather than declined. |
| DR-12 | **Promise returned where a void return was expected** (`welcomeModal.ts:116,121`). | **Fixed in 1.0.2** (`5bcb5a6`). Both click handlers explicitly `void` the async finish. |
| DR-13 | **`setWarning` is deprecated**; use `setDestructive` (`settingsTab.ts:327`). | **Kept for now, bundled into B018.** `setDestructive` does not exist at the 1.9.10 floor, so calling it would crash older clients. It swaps in when the floor rises past 1.13. |

### CSS lint

| Id | Finding | Disposition |
|----|---------|-------------|
| DR-14 | **`display: contents` only partially supported by Obsidian 1.7.4** (`styles.css`, two sites). | **Kept.** Both sites are plugin-owned panel layouts, and the plugin's floor is Obsidian 1.9.10, where `display: contents` is fully supported. The lint baseline (1.7.4) is below the floor. |
| DR-15 | **`text-decoration` feature only partially supported by Obsidian 1.7.4** (`styles.css`, the Notebook Navigator strikethrough). | **Kept.** Same floor argument: `text-decoration-thickness` is fully supported at 1.9.10. Below the floor the degradation would be cosmetic only (a default-thickness line). |
| DR-16 | **Avoid `!important`** (`styles.css`, four sites). | **Kept.** All four are `display: none !important` and are the hide mechanic itself, applied to surfaces the plugin does not own (tag pane rows, Properties pills, autocomplete suggestions) plus `.tc-hidden`, which exists specifically to replace inline `style.display` toggles so themes can restyle everything else. Winning by selector specificity against arbitrary themes and host rules is not reliable; for a display-only plugin whose one job is making a row disappear, `!important` on `display: none` is the correct tool. |

## Verification

Every fixed item shipped through the full release gate (lint with zero warnings, typecheck, the 412-test suite including the display-only invariant, production build), which runs both in branch CI and again at every tag before anything is published. The attestation fix (DR-02) was additionally verified by downloading the published 1.0.2 `main.js` and checking its provenance with `gh attestation verify`.

## Related records

- [CHANGELOG.md](../CHANGELOG.md): the 1.0.1 and 1.0.2 sections summarize the same work release by release.
- [CI.md](CI.md): release pipeline mechanics, including the attestation step and the three-asset release layout.
- [TESTING.md](TESTING.md): the release gate this work passed through.
