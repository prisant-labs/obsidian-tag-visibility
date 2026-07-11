# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

"See only the tags you want." The active visibility loop moves out of the Settings modal and into a real, dockable pane that sits beside the tag pane, so every change is visible as it lands. (Release pending final testing.)

### Added

- **Tag Visibility panel**: a dockable, splittable pane (not a settings screen) holding the tag table, filter chips, bulk actions, per-tag overrides, and per-row "why is this affected?" diagnostics. The table shows count, when a tag was last indexed, source, a visibility indicator, and the affecting rule; it is sortable, searchable, and virtualized for large vaults. The panel ships enabled, with an Enable toggle in General that removes the ribbon icon and pane when off, and has two modes: **View** (browse tags, tap a tag to search for it) and **Manage** (the full grid). Rules are authored in Settings > Custom rules, which carries the card-based editor and its live preview.
- **Open beside the tag pane**: the command opens the panel and the native tag pane as a split in one move, so your full tag inventory sits beside Obsidian's own list and both update as rules and overrides change.
- **All tags settings tab**: the full Manage grid is also available directly in Settings, to control tag visibility without opening the panel.
- **Reviewed triage**: a per-tag reviewed flag with Mark reviewed / unreviewed (row and bulk), a reviewed-row marker, and an Unreviewed filter, so a large tag set can be worked down like an inbox.
- **Per-tag overrides**: always-show and always-hide, a persisted per-tag decision that beats every rule. Always-show wins over everything (the safety net); always-hide beats every rule but yields to always-show. Overrides resolve ahead of rules, and the rule editor's preview accordion exposes per-row override pins.
- **Flag as a rule action**: besides hiding, a rule can flag its matched tags with a persistent accent mark (visible in both normal and preview mode, distinct from the amber preview highlight); the rule editor offers Hide and Flag.
- **Four scopes, each independently kill-switchable**: tag pane, Notebook Navigator, Properties, and Autocomplete. Hiding a tag hides it consistently across all four by default; each scope has its own kill switch so a single misbehaving surface can be turned off without disabling the plugin.
- **Hidden tags release their space in the core tag pane immediately**: after every decoration pass the plugin re-measures affected rows through the pane's own virtualizer (a model-DOM coherence sweep), so the list packs the moment rules change and heights restore when they are removed. Feature-detected against Obsidian internals; if a future Obsidian changes them, the sweep silently stands down and the pane reclaims space on its next natural redraw instead.
- **Notebook Navigator scope** via runtime interop only (no source coupling; Notebook Navigator is GPL-3.0, Tag Visibility is Apache-2.0). A silent no-op when Notebook Navigator is absent. Hidden tags are **dimmed and struck through** in the tree rather than removed: the tree's virtualizer reserves every row's slot, so removal would leave permanent blank bands; dimming keeps the tree packed with the suppression visible (and the rows clickable).
- **Properties scope**: the same hide/flag treatment for frontmatter tags rendered in the Properties panel.
- **Autocomplete scope**: hidden tags stop being suggested in the editor's tag autocomplete, so junk does not creep back.
- **Filtering**: one-click filter chips (relocated below the search bar): All, a **Visible** (shown-only) filter, Hidden, Flagged, Orphans, Frontmatter, Inline, and Unreviewed, plus a by-rule dropdown. A column selector and per-surface columns tailor the table to each host.
- **Presets**: each preset shows a live affected-count that clicks through to the matching tags.
- **Thin Settings**: Settings becomes set-once config, consolidated from an earlier ten-tab layout into a focused set (General, All tags, Scopes & integrations, Presets, Custom rules, Advanced, Help). Integration rows show status pills and action links.
- **Style Settings registration**: CSS variables registered with Style Settings so themers and power users can restyle hidden and flagged tags with no code; sensible defaults apply when Style Settings is absent.
- **Tag Wrangler delegation**: a per-row "Rename with Tag Wrangler" menu item and a bulk "Send to Tag Wrangler" action when Tag Wrangler is present; gracefully hidden or disabled when absent.
- **Trust layer polish**: a welcome modal that leads with the plugin name and de-overclaims, the persistent non-default-state banner, panic disable that clears every scope at once, and an honest, scope-independent status bar.

### Changed

- **Six palette commands**: toggle enable, panic disable, toggle preview mode, open the panel, open beside the tag pane, and rescan vault tags. The standalone tag-list commands from v0.1 were retired; the panel subsumes them.
- Settings consolidated from ten tabs into a focused set, and inline styles were moved to CSS classes (themable, and to satisfy the plugin review guidelines).
- The panel is titled "Tag Visibility"; rule editing is name-first with type cards and an anchored "New rule" action.
- Panic disable now removes display effects across all four scopes in one shot, not just the tag pane.

### Fixed

- **Autocomplete suppression works on Obsidian 1.12+.** The editor's tag suggester now renders suggestions as bare names (no leading `#`), which silently defeated the old prefix-based detection - hidden tags reappeared in the popup. Tag suggestions are now also recognized by typing context (the cursor sitting in a `#token`, with wikilink/heading contexts excluded), so suppression works on both old and new suggestion markup.
- **Notebook Navigator decorations survive clicks and selection.** NN re-renders rows on selection and rewrites their classes in place, which used to strip the dim + strikethrough from the clicked row (and re-rendered neighbors) until unrelated redraws restored it. The observer now watches class rewrites and re-applies within a frame.

### Migration

- Settings schema advances to **v10**, automatic and additive. Early steps introduce the per-tag `overrides` store (defaulting to `{}`) and per-scope enables; later steps add the pane availability state (`paneEnabled`, on by default), per-surface column preferences, and move the reviewed flag into durable settings (`reviewedTags`). Migrations are one-way and guarded, and a `data.json` written by a newer plugin version is treated as read-only so it can never be downgraded. No user action required.

### Known limitations

- On very large vaults the core tag pane can briefly show a stale glyph or a blank region right after a vault edit, or while scrolling fast through a dense hidden block, until the plugin's next pass (a frame or so later) re-decorates the rows and repairs the pane's height model. Cosmetic and self-healing; normal vaults are unaffected, and the panel and Properties scope are never affected.
- Enabling the plugin or running a full reindex scans the whole vault. On very large vaults (tens of thousands of files) this can take roughly 10 to 15 seconds. A chunked, incremental scan is planned for 1.1.
- The status bar item is desktop-only, because Obsidian does not render a status bar on mobile. Every display scope still works on mobile.
- For a few seconds after startup on very large vaults, the status bar can read "0 tags hidden" while tags are already visibly hidden: the count comes from the tag index, which is still being built, while the display scopes act on rendered rows immediately. It corrects itself when the first scan completes.

## [0.1.0] - 2026-05-14

Initial public release.

### Added

- Rule engine with three match types: regex, frequency, and explicit list.
- Priority-based rule evaluation: the highest-priority matching enabled rule wins.
- Five built-in presets: hex color codes, URL anchor fragments, single-character tags, purely numeric tags, orphan tags.
- Tag-pane filtering via scoped MutationObserver and class-based hiding (no DOM removal).
- Tag list view: sortable, searchable, with filter chips and rule-attribution status column.
- Custom rule editor: regex / frequency / list, live affected-tag preview, regex safety validation against iOS lookbehind crash, test field.
- Master enable / disable toggle wired to a status bar item.
- Preview mode: visibly flag matched tags rather than hide them, so you can see a rule's impact before committing.
- Panic disable command: full DOM cleanup plus settings off-switch.
- Status bar item: shows hidden tag count, preview-mode state, or off-state; click to open tag list filtered to hidden.
- Tag metadata sidecar (`tags.json`): first seen, last seen, count, source per tag.
- Schema-versioned settings with migration from any prior local v0 state.
- `onExternalSettingsChange` support: reload settings cleanly when Obsidian Sync rewrites `data.json`.
- Apache 2.0 license, README polished for community plugin directory submission.

### Technical

- TypeScript 5.6, esbuild 0.24, CJS bundle, no runtime dependencies.
- `minAppVersion`: 1.9.10. `isDesktopOnly`: false.
- iOS-safe regex compile (lookbehind rejected at compile time).
- Storage split: settings in `data.json`, tag metadata in `tags.json`, avoiding write races.
- All event subscriptions registered via `registerEvent`, all observers via `register(() => obs.disconnect())`, ensuring zero leaks on unload.
- GitHub Actions: build on push and PR, release on tag push with `manifest.json`, `main.js`, `styles.css`, `versions.json` attached.

### Changed (post-initial-tag)

- **Renamed "dry-run" to "preview mode" everywhere** (settings field `dryRun` -> `previewMode`, observer `setDryRun` -> `setPreviewMode`, command `toggle-dry-run` -> `toggle-preview-mode`). Settings schema bumped v1 -> v2 with automatic migration that maps the old `dryRun` value onto `previewMode` on first load; nothing for users to do. BRAT testers who bound a hotkey to `toggle-dry-run` will need to rebind to `toggle-preview-mode`.

### Fixed (post-initial-tag)

- **Rule precedence bug:** when more than one rule matched the same tag, the *lowest*-priority match was returned as the winner instead of the highest. Sorting was priority-descending but the iteration kept the last match, inverting the semantics. The diagnostic ("why is this tag affected?") attributed the wrong rule. Fixed: highest-priority match wins, matching what the "priority" label implies. Tests updated.

### Known limitations

- Tag pane is the only scope filtered in v0.1.0. Editor autocomplete, properties chips, and other scopes are planned for v0.2.
- Hide is the only action. Flag, group, alias, and color delegation are planned for v0.2 / v0.3.
- No profiles, aliases, or inbox mode in v0.1.0. These are planned for v0.3.
- No Tag Wrangler, Notebook Navigator, or Colored Tags Wrangler integration yet. Planned for v0.3 to v0.4.
- Graph view and Bases scopes deferred to v0.5+ because of canvas rendering and Bases API volatility, respectively.
