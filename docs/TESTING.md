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

---

> **Historical (v0.1), superseded.** Everything below predates the v1.0 UI and is retained for reference only. It describes tabs, commands, columns, rule actions, and schema numbers that no longer match the shipped plugin (for example: an 8-tab Settings layout with Profiles/Aliases, `open-tag-list` commands, a "First seen" column, show-only/group actions, a per-rule Scope dropdown, a debug-logging toggle, and `schemaVersion: 3`). Do NOT use it to gate a release; the current sections above are the gate.

## What v0.1 ships

| Surface | Where it lives | Notes |
|---|---|---|
| Welcome modal (D-008) | Fires once on first enable (gated by `seenWelcomeModal`) | Acknowledges "Tag Visibility is now enabled"; preset cards with toggles; integration cards; **Start hiding tags** or **Start in preview mode** CTAs. |
| Settings tab (8 sub-tabs) | Obsidian Settings > Tag Visibility | Top-tab layout: **General / Tag list / Presets / Custom rules / Commands / Advanced**, plus deferred placeholders **Profiles (v0.2)** and **Aliases (v0.3)**. |
| Tag list view (D-011) | Same component, two hosts | Sidebar leaf (command + status-bar click) AND Settings > Tag list tab. State stays in sync. |
| Rule editor (D-010) | Settings > Custom rules tab | Card view + right-docked preview. Click any card to enter edit mode (no separate wizard, D-002 closed). |
| State banner (D-007) | Top of every Tag Visibility surface | Persistent. Two variants: `Preview mode is on` (amber) and `Tag Visibility is off` (muted). One-click action to restore default. |
| Status bar | Bottom of Obsidian | Shows hidden count or `(preview): N flagged` or `off`. Click to open the Tag list filtered to hidden. |
| Commands (6 total) | Cmd/Ctrl+P palette | `toggle-enable`, `panic-disable`, `toggle-preview-mode`, `open-tag-list`, `open-tag-list-hidden`, `rescan-tags`. |

## Testing Checklist

### 1. First-run welcome modal (D-008)

On a fresh install with `seenWelcomeModal: false`:

- [ ] Modal opens once on first enable (after the initial tag scan completes).
- [ ] Header says "Tag Visibility is now enabled" and "Choose how to start" (no "Got it, enable" wording).
- [ ] Safety promises strip shows three left-aligned check rows (Display-only / File-safe / Fully reversible). Not three centered chunky cards.
- [ ] Two preset cards visible (Hide hex color codes, Hide URL anchor fragments). Toggling a card off writes through immediately.
- [ ] Integration cards show name + state pill (Enabled / Installed / Not installed) + bulleted "what changes". Tag Wrangler and Notebook Navigator appear with their detected states.
- [ ] **Start hiding tags** primary button closes the modal and applies the enabled presets.
- [ ] **Start in preview mode** secondary button enables Preview mode (matched tags become flagged, not hidden), then closes.
- [ ] After dismissal, modal does not reappear on subsequent reloads.

### 2. State banner (D-007)

- [ ] When Preview mode is on, the amber `Preview mode is on. Matched tags are flagged...` banner appears above the active panel in **Settings > General**, in the **Tag list view** (both hosts), and in the **Custom rules tab**.
- [ ] Banner action button `Turn off preview` clears the banner from every surface simultaneously.
- [ ] When the plugin is disabled, the muted `Tag Visibility is off...` banner appears in the same places.
- [ ] Banner action button `Turn on` re-enables the plugin and clears the banner.
- [ ] In the default state (enabled, Preview off), no banner is shown anywhere.

### 3. Settings tab structure

- [ ] All 8 tabs render (General, Tag list, Presets, Custom rules, Commands, Advanced, Profiles, Aliases).
- [ ] Tab badges: Tag list shows current tag count; Presets shows "5"; Custom rules shows custom rule count; Profiles shows "v0.2"; Aliases shows "v0.3".
- [ ] Tab switching does not lose state (filters, selections in Tag list / Custom rules survive a tab away and back).

### 4. General tab

- [ ] **Stats header**: 4 cards (Total tags / Hidden now / Active rules / Orphans) with live numbers.
- [ ] **Enable Tag Visibility** toggle persists immediately.
- [ ] **Preview mode** toggle persists and changes the tag pane: matched tags become flagged (with the FLAG class) instead of hidden.
- [ ] **Panic disable** row (under "If something looks wrong"): clicking `Run panic disable` instantly un-hides every tag, disables the plugin, and the muted state banner appears across surfaces.

### 5. Tag list tab + sidebar leaf (D-011)

In both hosts:

- [ ] Search input filters live as you type.
- [ ] 5 filter chips work (All / Hidden / Orphans / Frontmatter / Unreviewed); the active chip highlights.
- [ ] Click a column header to sort; click again to toggle direction.
- [ ] Help icons (`?`) on Count / First seen / Last used / Source / Visible? each reveal a tooltip on hover.
- [ ] Row classes: hidden rows are struck through; flagged rows use the warning color.
- [ ] Rule column shows **all matching rules stacked on separate lines** (no "+ N more" collapse).
- [ ] Per-row checkboxes plus a header checkbox; selecting any row reveals the bulk-actions bar.
- [ ] Bulk-actions bar shows `N selected of M on this page`, with Hide / Unhide / Send to Tag Wrangler (only if Tag Wrangler is enabled) / Clear.
- [ ] Selection and filter state are identical in both hosts (open the Tag list in the sidebar leaf and the Settings tab simultaneously; changing one should reflect after the next render).

### 6. Presets tab

- [ ] All 5 preset cards render with toggles.
- [ ] Each card shows `N tags affected` (color-accented if the preset is on, faint if off).
- [ ] `More details` link expands the card to show the match pattern, action, scope, and notes.
- [ ] Toggling a preset off immediately updates the tag pane and the affected-count chip on other cards if applicable.
- [ ] Defaults: `Hide hex color codes` and `Hide URL anchor fragments` are on; `Hide single-character tags`, `Hide purely numeric tags`, and `Hide orphan tags` are off.

### 7. Custom rules tab (D-010 rule editor)

**Card view:**

- [ ] Each rule renders as a full-width card with enable toggle | name (16px / 700) | Type pill + match summary | "N tags affected" | chevron.
- [ ] The toggle on a card persists immediately without entering edit mode.
- [ ] Clicking anywhere on a card except the toggle opens edit mode.
- [ ] The dashed `+ New rule` card opens edit mode with defaults (`regex`, empty pattern, `hide`, `tag-pane`).
- [ ] **Right-docked preview** in card view shows every tag any rule is currently affecting, sorted by count.

**Edit mode:**

- [ ] View header shows a breadcrumb row (`← Back to rules / Custom rules / New|Edit rule`) and a prominent h2 title row (toggle + 24px/700 rule name).
- [ ] **Type** dropdown shows plain-language labels: "Pattern match (regex)" / "Count threshold (frequency)" / "Specific tags (list)". Changing it resets the Match input.
- [ ] **Identity** section shows Name input only (no Priority row, D-009). Hint line below names the engine default of 50.
- [ ] **Match** section reads as a sentence: "When a tag's name [matches the regex] [^draft(-|$)]" for regex; "[has a count that] [<=] [1]" for frequency; "[is one of] [wip, todo, fixme]" for list.
- [ ] Regex pattern field shows live `✓ valid` or `✗ {error}` status as you type.
- [ ] **Then** section shows Action dropdown (hide / flag / show-only / group) + Scope dropdown (tag-pane only for v0.1; tag-pane + graph option is disabled with "(v0.2)" suffix).
- [ ] **Right-docked preview** updates live as you type the pattern.
- [ ] **Delete rule** button appears for existing rules (not for new), shows a confirmation modal.
- [ ] **Save** button validates name + regex (if applicable) and persists; **Cancel** discards.
- [ ] Highest-priority-match-wins behavior (Q-005): create two rules at priority 100 and 50 that both match the same tag (priority is hidden in UI but custom rules default to 50; you'll need to edit `data.json` to set 100, or add a second rule that wins via specificity). Verify the higher-priority rule attributes as the effective rule in the Tag list view's Rule column.

### 8. Commands tab

- [ ] Lists all 6 v0.1 commands with descriptions.
- [ ] Each command in the palette (Cmd/Ctrl+P) is prefixed `Tag Visibility:` and behaves as described:
  - `Toggle enable` flips the master switch; Notice confirms new state.
  - `Panic disable` removes all DOM effects and disables; Notice confirms.
  - `Toggle preview mode` flips Preview; Notice confirms; status bar changes to `(preview): N flagged`.
  - `Open tag list view` opens or reveals the sidebar leaf.
  - `Open tag list (hidden tags only)` opens the leaf and applies the Hidden filter chip.
  - `Rescan vault tags` re-runs `scanAll`, shows a "rescanning..." and a "complete" Notice.

### 9. Advanced tab

- [ ] Index maintenance heading.
- [ ] `Reindex now` button rescans the vault (same as the `rescan-tags` command), Notice on start + complete.
- [ ] `Last full reindex` row shows the current tag count.
- [ ] Sidecar save debounce (ms) input accepts a number, persists, gets clamped to >= 500.
- [ ] Debug logging toggle persists.
- [ ] Mode dropdown shows Default + allow-only (v0.2, disabled) + inbox (v0.2, disabled).

### 10. Status bar item

- [ ] When enabled and Preview off: shows `Tag Visibility: N tags hidden` (or `1 tag hidden` at N=1).
- [ ] When Preview on: shows `Tag Visibility (preview): N flagged`.
- [ ] When disabled: shows `Tag Visibility: off`.
- [ ] Clicking the item opens the Tag list pre-filtered to Hidden.

### 11. Preview mode (was "dry-run")

- [ ] Setting key in `data.json` is `previewMode` (not `dryRun`).
- [ ] If migrating from a pre-v3 install: legacy `dryRun: true` should map to `previewMode: true` and the schema bumps to 3 on first load. (See **Migration** section below.)
- [ ] When Preview mode is on, matched tags carry the `tag-curator-flagged` class (not `tag-curator-hidden`); they remain visible with a flag style.
- [ ] When Preview mode is on, the status bar shows `(preview): N flagged`.

### 12. Schema migrations

Reset the test vault's `.obsidian/plugins/tag-visibility/data.json` to each state and verify clean migration:

- [ ] **No file** → loads with defaults, writes `schemaVersion: 3` on first save.
- [ ] **`{schemaVersion: 1, dryRun: true, ...}`** → loads with `previewMode: true`, `seenWelcomeModal: false`, `schemaVersion: 3`.
- [ ] **`{schemaVersion: 2, previewMode: true}`** → loads with `seenWelcomeModal: false`, `schemaVersion: 3` (and the welcome modal fires once on next enable).
- [ ] **`{schemaVersion: 3, ...}` with a `futureField`** → does NOT overwrite the file with a downgraded shape (downgrade-guard test).

### 13. Tag Wrangler integration (spec §6.1.1)

Only relevant if Tag Wrangler is installed in the test vault.

- [ ] When Tag Wrangler is **not** installed/enabled, the `Send to Tag Wrangler` bulk button is hidden.
- [ ] When Tag Wrangler is enabled, selecting 1-3 tags in the Tag list and clicking `Send to Tag Wrangler` triggers Tag Wrangler's rename modal. Tag Visibility shows a Notice confirming how many tags were dispatched.
- [ ] Tag Wrangler does the actual rename; Tag Visibility's tag list refreshes on the next `metadataCache.changed` event.
- [ ] No files are modified by Tag Visibility itself.

### 14. File safety

- [ ] No `.md` files in the vault are modified during any of the above.
- [ ] No `.obsidian/` files are touched outside of `plugins/tag-visibility/data.json` and `plugins/tag-visibility/tags.json`.
- [ ] Disable the plugin in Community Plugins: every tag becomes visible again immediately.
- [ ] Uninstall the plugin: every tag is visible, the plugin's data folder remains until the user removes it.
- [ ] Re-enable after a disable: previously-hidden tags hide again without a reload.

### 15. Performance

- [ ] Small vault (10-20 notes): tag pane is instant.
- [ ] Medium vault (~500 notes): no perceptible lag on rule toggle.
- [ ] Large vault (~10k tags synthetic): tag pane re-applies rules in under 200 ms on a recent laptop. No CPU spike when typing in a note.
- [ ] Settings tab loads and switches between sub-tabs without lag.

## Known v0.1 limitations (these are NOT bugs)

These items intentionally surface a Notice or are deferred to v0.2+. If a tester reports them as bugs, redirect to the GitHub issue noted:

- **Bulk Hide / Bulk Unhide / Bulk Add description** in the Tag list show a Notice pointing to **B009** (Tag detail sheet, v0.2). Per-tag overrides land with that surface.
- **Welcome modal integration detection** uses a hardcoded card set; full live detection is **B004** (v0.2).
- **Organization panels** (Recently created / Orphans / Stale / Suggested merges / Untagged notes) are deferred to v0.2 - only the Tag list view's filter chips approximate these.
- **Drag-to-reorder rules** is **B012** (v0.2). v0.1 hides priority entirely; new custom rules default to 50.
- **Compound criteria builder (AND/OR/NOT)** is **B001/B002** (v0.2).
- **Aliases / merge workflow** is **B006** (v0.3).
- **Tag analytics dashboard** is **B007** (v0.3, "liked" by reviewer).
- **Graph view / autocomplete / properties chip scopes** are v0.2+.

## v0.1.0 BRAT smoke matrix

Walk the 6 cells before tagging. (The 24-cell sweep in implementation plan §7.5 is for the v0.3+ community-plugin-directory submission.)

| # | Vault size | Platform | Theme | Companion plugins |
|---|---|---|---|---|
| 1 | Small (10-20 notes) | Win11 desktop | Default dark | None |
| 2 | Small (10-20 notes) | Win11 desktop | Default light | None |
| 3 | Medium (200+ notes) | macOS or Linux | Default dark | Tag Wrangler enabled |
| 4 | Medium (200+ notes) | iOS (Obsidian Mobile) | Default | None |
| 5 | Large (~10k tags synthetic) | Win11 desktop | Default dark | None |
| 6 | Empty vault (0 notes) | Win11 desktop | Default | None |

For each cell, sample these from the full checklist:

1. Plugin loads with zero console errors (Ctrl+Shift+I).
2. Welcome modal appears once on first enable (cells 1-2, 5-6 will see it).
3. State banner appears when Preview mode is toggled and when the plugin is disabled.
4. Settings tab opens and all sub-tabs render.
5. Tag list view opens in both hosts (sidebar leaf + Settings tab) and shows live data.
6. At least one preset hides at least one tag.
7. Creating a custom rule works (card view + edit mode + save).
8. Status bar reflects the current state (hidden count / preview / off).
9. Panic disable un-hides every tag and persists `enabled: false`; banner shows; re-enable from the banner returns everything.
10. Cell 3 only: Tag Wrangler integration - selecting tags and `Send to Tag Wrangler` opens Tag Wrangler's rename modal.

If any cell fails, fix and re-run that cell before tagging.

## Tagging the release (v0.1 procedure)

After all 6 cells pass:

```bash
git status --short                    # must be empty
git checkout main
git merge --no-ff release/v0.1.0 -m "release: v0.1.0"
git tag 0.1.0
```

Do not push the tag automatically. Confirm with the user before:

```bash
git push origin main
git push origin 0.1.0
```

The tag push triggers `.github/workflows/release.yml`, which uploads `manifest.json`, `main.js`, `styles.css`, and `versions.json` to the GitHub release.
