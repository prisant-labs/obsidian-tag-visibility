# Testing Guide

How to verify Tag Visibility before tagging a release. The **v1.0 manual smoke matrix** and the
**pane and Settings detail checks** below are the current gate; the automated side (lint, typecheck,
tests, build) is described in [CI.md](CI.md). The detailed v0.1 checklist at the bottom is retained as
historical reference only: it predates the v1.0 UI, and its specifics (Settings tabs, commands, schema
numbers, rule actions) are stale. Gate a release on the current sections, not the v0.1 checklist.

## Local Testing Setup

### Prerequisites

- Obsidian (latest stable, minimum 1.9.10)
- A test vault separate from your main vault
- Node.js 20+ and npm

### Build and Install

1. Clone the repository: `git clone https://github.com/prisant-labs/obsidian-tag-visibility.git`
2. Install dependencies: `npm ci`
3. Build the plugin: `npm run build`
4. Copy artifacts to the test vault:
   ```bash
   mkdir -p /path/to/test-vault/.obsidian/plugins/tag-visibility
   cp main.js manifest.json styles.css /path/to/test-vault/.obsidian/plugins/tag-visibility/
   ```
5. Reload plugins in Obsidian settings (toggle off and on)
6. Enable Tag Visibility

### BRAT pre-release install (recommended for tester walks)

1. Install the BRAT plugin in the test vault.
2. Add this repo as a beta plugin: `https://github.com/prisant-labs/obsidian-tag-visibility`.
3. Pick the latest tag (the `release.yml` workflow attaches `main.js`, `manifest.json`, `styles.css`, `versions.json` to every tagged release).

## v1.0 manual BRAT smoke matrix

Walk this before tagging v1.0. It is the current gate. (The v0.1 checklist further down is historical only; see the note above.) Run on a real BRAT install (not just a local copy) so the release-asset path is exercised. Several cells need specific companions or content, noted inline.

### A. The Tag Visibility panel and the live loop

- [ ] **Open the panel.** Run "Tag Visibility: Open the panel". The Tag Visibility panel opens with the tag table, filter chips, and bulk actions (rules are edited in Settings > Custom rules, not in the panel). Zero console errors (Ctrl+Shift+I).
- [ ] **Open beside the tag pane.** Run "Tag Visibility: Open beside the tag pane". The panel and the native tag pane appear side by side as a split, arranged in one move.
- [ ] **Live reaction.** With the panel and tag pane visible, add or edit a rule in Settings > Custom rules (for example a regex that matches a hex-code tag). The editor's live preview lists affected tags as you type; on save, the panel's tag table and the native tag pane both react (matched tags hide, or flag in preview mode) without closing or reopening anything.
- [ ] **The pane fills on open, and refills on resize (DA-25).** On a vault with more tags than fit on screen, open the panel: the list must be populated all the way down to the bottom of the pane on the FIRST paint, with no blank area below a handful of rows, and without scrolling to force it. Then drag the sidebar divider to make the pane taller: the new space must fill with rows. (Both symptoms of the same bug: the table used to size its window from a container it measured before the pane had been laid out, read that as a zero-height viewport, and never recomputed.)
- [ ] **Per-row diagnostics.** On an affected row, use "why is this affected?" and confirm it names the exact preset, rule, or override responsible.
- [ ] **Bulk actions.** Select several tags and confirm hide / unhide / mark reviewed / send to Tag Wrangler operate on the selection.
- [ ] **Launchers reveal the panel.** Open the panel from the ribbon icon, the command palette ("Open the panel" and "Open beside the tag pane"), and the status-bar click; each time it becomes visible in the sidebar (not hidden behind a modal). Settings has no open-panel button.

### B. Each scope hides/flags

Hiding a tag should, by default, hide it consistently across all four scopes. Confirm each surface reacts:

- [ ] **Tag pane.** A hidden tag disappears (or flags in preview mode) in the native tag pane, and its space is reclaimed: the list packs with no blank band where the tag was, and un-hiding restores the row's height.
- [ ] **Tag pane, nested display.** With "Show nested tags" on and a nested tag such as `#a/b` in the vault: hiding `a/b` (list rule or always-hide pin) hides its child row, and a rule matching only a bare `b` does NOT hide `a/b`'s row. (Guards the leaf-segment row-resolution risk in hierarchy mode.)
- [ ] **Notebook Navigator.** Requires a real Notebook Navigator vault (>= 2.0.0). A hidden tag is **dimmed and struck through** (still clickable) in NN's tag tree; a flagged tag shows the flag accent. **Click a dimmed tag**: the strikethrough survives selection (a one-frame blink is fine; staying lost is a failure). With NN absent, this scope is a **silent no-op** (no errors, nothing logged at non-debug levels).
- [ ] **Notebook Navigator load order.** In a vault where Tag Visibility was enabled BEFORE Notebook Navigator (or after toggling NN off and on, then restarting), NN rows still decorate after a restart. (Guards the plugin-load-order regression: detection defers to `onLayoutReady`.)
- [ ] **Properties.** Requires a note with frontmatter `tags:`. Open that note's Properties panel and confirm a hidden tag is hidden/flagged there.
- [ ] **Autocomplete.** In the editor, type `#` and start a hidden tag's name; confirm the hidden tag is not offered as a suggestion (suggestions render as bare names on Obsidian 1.12+; detection is context-based). Then type `[[` + a note name + `#`: heading suggestions must be unaffected, even for headings that look like hidden tags.

### C. Per-tag overrides hold across surfaces

- [ ] Pin a tag to **always-show** from its row in the panel; confirm it stays visible in the tag pane, NN, Properties, and autocomplete even when a rule would hide it.
- [ ] Pin a different tag to **always-hide**; confirm it is hidden across the surfaces with no rule authored for it.
- [ ] Confirm always-show wins over always-hide and over any matching rule.

### D. Per-scope kill switches

- [ ] In **Settings > Scopes & integrations**, toggle each scope off one at a time. Confirm that scope's decorations clear immediately on its surface while the other scopes keep working and the plugin stays enabled.
- [ ] Toggle the scope back on; decorations re-apply without a reload.

### E. Panic disable clears everything

- [ ] Run "Tag Visibility: Panic disable" (or Settings > General > Run panic disable). Confirm display effects clear across **all four scopes** at once, the plugin disables itself, and the "Tag Visibility is off" banner appears across surfaces.
- [ ] Re-enable from the banner; previously-hidden tags hide again across scopes.

### F. Reversibility and honesty

- [ ] **Uninstall restores everything.** Disable, then uninstall the plugin; every tag is visible again across every surface. No `.md` file was modified.
- [ ] **NN absent is a silent no-op.** In a vault without Notebook Navigator, the NN scope does nothing and logs nothing at non-debug levels; no errors.
- [ ] **Honest status bar.** The status bar shows a truthful count for the current state: `N tags hidden` (plus a separate flagged count when a flag rule is active), `N would be hidden` in preview mode, or `off`. It is scope-independent. Click it to open the panel filtered to hidden.
- [ ] **Corrupt data.json does not erase your settings (B-01, corrupt data.json guard).** With at least one custom rule and one tag override saved, hand-corrupt the plugin's `data.json` (truncate it or write invalid JSON). Restart Obsidian. Expected: a Notice appears stating the file could not be read; the state banner shows a persistent read-only indicator; the plugin runs on defaults for the session; and after quitting Obsidian, the corrupt file is still on disk unchanged (not replaced with defaults). Restore a valid backup, restart, and confirm the original rules and overrides return and that settings now save normally.
- [ ] **Future-schema guard is visible and non-destructive (B-03, read-only mode notice).** Hand-edit the plugin's `data.json` and set `schemaVersion` to a number above the plugin's current version (simulating a file synced from a device running a newer release). Restart. Expected: a Notice appears naming the cause and the remedy; the state banner shows a persistent read-only indicator; toggling a setting repaints in-session but the change does not survive a restart; and the file keeps its higher `schemaVersion` (not downgraded by the plugin).
- [ ] **Deferred startup scan decorates and counts correctly (D-01, layout-ready deferral).** On a large vault, restart Obsidian and confirm that hidden tags are decorated in the tag pane and the other active scopes; the status-bar count may arrive a moment after launch, which is expected since the scan now starts after all plugins finish loading. On a fresh-install vault (or after removing `data.json` to simulate first run), confirm the welcome modal appears after the scan completes and shows a populated tag list.
- [ ] **Saved sidecar survives startup on a large vault (B-05, cold-cache sidecar wipe).** On a large vault (thousands of notes), quit Obsidian fully, then relaunch it. The Tag Visibility panel must populate with tags after a brief delay while the index builds; "No tags yet" is a failure. The status bar must show a real hidden-tag count once the scan completes; a brief "0 tags hidden" during the first few seconds while the index is still building is expected and correct. Confirm that `tags.json` in `.obsidian/plugins/tag-visibility/` inside the vault folder is still substantial: check its file size - a healthy sidecar for a large vault is hundreds of kilobytes, not tens of bytes. A file containing only `{"schemaVersion": 2, "tags": {}}` (roughly 38 bytes) means the sidecar was wiped and the fix did not hold.

### G. Environment sweep

Sample cells A-F across these environments before tagging:

| # | Vault size | Platform | Theme | Companion plugins |
|---|---|---|---|---|
| 1 | Small (10-20 notes) | Win11 desktop | Default dark | None |
| 2 | Small (10-20 notes) | Win11 desktop | Default light | Style Settings enabled |
| 3 | Medium (200+ notes) | macOS or Linux | Default dark | Tag Wrangler + Notebook Navigator (>= 2.0.0) enabled |
| 4 | Medium (200+ notes) | iOS (Obsidian Mobile) | Default | None (status bar absent on mobile is expected) |
| 5 | Large (~10k tags synthetic) | Win11 desktop | Default dark | None |
| 6 | Empty vault (0 notes) | Win11 desktop | Default | None |

If any cell fails, fix and re-run that cell before tagging.

## H. Pane and Settings detail checks

Current-behavior spot checks that complement the smoke matrix. These were introduced with the v1.0 UI work and remain part of the gate.

### H1. Pane View/Manage modes

- [ ] Pane opens in View: tag names are links that open a tag search; no checkboxes/bulk bar/row menu; a Filters disclosure expands/collapses the chip row. Switch to Manage: checkboxes, bulk bar, and row menus return and chips show normally. The All tags settings tab is unaffected (always full Manage). Header and rows stay column-aligned in View.

### H2. Split Rules tabs

- [ ] Settings shows Presets and Custom rules as separate tabs, each with a count badge; the old combined Rules tab is gone.

### H3. Help tab compact command table

- [ ] Help tab shows commands as a compact two-column table (name + description), not a tall list of setting rows; FAQ and About still present.

### H4. Panel toolbar layout

- [ ] The panel toolbar shows the search box on top and the filter chips on their own row directly beneath it (not side by side).

### H5. Row menu: Mark reviewed / Mark unreviewed

- [ ] Row menu shows "Mark reviewed"; after clicking it, re-opening the same row's menu shows "Mark unreviewed", and the tag leaves the Unreviewed filter.

### H6. Bulk bar: Mark reviewed

- [ ] Select 2 or more tags, click Mark reviewed in the bulk bar: all selected tags leave the Unreviewed filter.

### H7. Settings All tags tab

- [ ] Settings -> All tags shows the full Manage grid (search, chips, selection, bulk bar, row menu, virtual scroll). Switching to another tab and back, and closing/reopening Settings, does not duplicate rows or leak scroll listeners.

### H8. Enable Tag Visibility pane toggle

- [ ] General has no Open button. Toggling Enable Tag Visibility pane OFF removes the ribbon icon and closes any open Tag Visibility pane; toggling ON restores the ribbon. With the pane OFF, the 'Open the panel' / 'Open beside the tag pane' commands show a Notice. The Presets-tab 'N tags affected' deep-link and the status-bar click still open the pane regardless (they are not gated).

### H9. Rule deep-link opens pane in Manage mode

- [ ] Clicking a Presets 'N tags affected' deep-link opens the pane in Manage mode (checkboxes/bulk available) filtered to that rule's tags. The status-bar click still opens in the default View.

### H10. Cross-surface refresh and subscription hygiene

- [ ] After a preset deep-link (clicking "N tags affected" in Presets tab), clicking the status bar shows ALL hidden tags (the rule filter is cleared, not narrowed to the prior rule).
- [ ] With the All tags settings tab open, external changes (toggling a rule, rescanning vault tags) refresh the table without closing and reopening Settings.
- [ ] Switching between Custom rules and All tags tabs repeatedly does not leak editor or table subscriptions (confirmed via zero extra settingsManager listener warnings in the console).

## Pre-release gate (CI-side, before tag)

Before tagging (see [CI.md](CI.md) for the full pipeline):

1. `npm run lint` - must pass (`--max-warnings 0`).
2. `npm run typecheck` - tsc clean.
3. `npm test` - the full vitest suite must pass.
4. `npm run build` - artifacts written.
5. Walk the smoke matrix and detail checks above.
6. Merge to `main` and wait for the GitHub Actions `build.yml` run to go green **before** pushing the tag: the tag-triggered `release.yml` re-runs the same gate at the tagged commit, and a red gate after the tag push means delete-tag-and-retag.
7. Update `CHANGELOG.md`: roll the `Unreleased` heading to the release date and drop any "pending" notes.
8. Confirm `manifest.json` version + `versions.json` entry + `package.json` version all match (the `npm version` script keeps them in sync).

## Debugging

### Common Issues

**Tags still showing after enabling a rule?**

- Confirm the rule's enable toggle is on (the left-edge toggle on its card in Settings > Custom rules).
- Open the Tag Visibility panel, find the tag, and check its visibility indicator; if it reads as shown, no enabled rule matched it.
- Open the rule in edit mode and check the live preview; it shows matches as you type.

**Rule not matching as expected?**

- For regex rules, the field shows live `✓ valid` / `✗ {error}` status.
- The editor's live preview lists every tag the current pattern matches; if it is empty, the pattern probably does not match what you think.
- Remember tag names are matched **without** the leading `#` (the rule editor strips a typed `#` from list entries for you).

**Welcome modal doesn't appear on what should be a fresh install?**

- Check `data.json`'s `seenWelcomeModal`. If true, the modal won't fire. Set it to `false` and reload to retest.

**State banner doesn't appear when expected?**

- The banner only shows for non-default states (Preview on, or plugin disabled). In the default enabled state, no banner is shown - that's correct.

**Performance issues?**

- Settings > Advanced > Index maintenance > Last full reindex shows the current tag count. If it's surprisingly large, you may have a vault that just needs the one-time scan to settle.
- Disable unused presets and rules.
- Sidecar debounce is 5000ms by default - lower values write more often.

## Reporting Issues

If you find issues during testing:

1. Note the exact steps to reproduce.
2. Include vault size (number of notes/tags).
3. Share browser console errors.
4. Describe expected vs. actual behavior.
5. Open a GitHub issue with this information; link to the relevant checklist section above.

## Testing on Different Systems

Verify on:

- Windows desktop with Obsidian
- macOS desktop with Obsidian
- Linux desktop with Obsidian (if available)
- iOS Obsidian Mobile (cell 4)

The plugin is **not** desktop-only (`isDesktopOnly: false`), so mobile must work; the only desktop-specific surface is the status bar (Obsidian doesn't render one on mobile).

Historical v0.1 testing content (superseded by the v1.0 gate above) has moved to [docs/archive/testing-v0.1.md](archive/testing-v0.1.md).
