# Historical v0.1 testing checklist (superseded)

Moved verbatim from docs/TESTING.md on 2026-07-11; superseded by the v1.0 gate there. Retained for reference only.

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
