# How Tag Visibility Works

Tag Visibility changes how your tags *look* across Obsidian, never what they *are*. This page explains the idea in plain language first, then goes under the hood for engineers. The top half is for everyone; the "Under the hood" section and the second FAQ tier are for the technically curious.

Looking for how to install and use it? See the [README](../README.md). This page is about *how it works* and *why it is safe*. For the full engineering reference (module map, sequence diagrams), see [ARCHITECTURE.md](ARCHITECTURE.md).

## In one idea

Think of Tag Visibility as a **view layer for your tags**. Like hiding rows in a spreadsheet without deleting the data, or putting on glasses that simplify what you see: the tags are all still there, in your notes and in Obsidian's own tag list. Tag Visibility only changes what gets drawn on screen.

That single idea is the whole safety story, and it is structural rather than a setting: the plugin has no code that writes to your notes in the first place. Because nothing is ever written, turning the plugin off (or uninstalling it) brings every tag back instantly. There is nothing to undo.

## What it does for you

Vaults accumulate noisy tags: hex colors pasted from the web (`#FFAA00`), URL fragments (`#section-3`), one-off tags used in a single note. Tag Visibility lets you **hide** noisy tags, **flag** them (highlight them in place instead of hiding), and pin the ones you always want to keep visible, across the places tags actually appear.

You do this from the **Tag Visibility panel**, the plugin's own dockable pane, where every tag in your vault appears in a table you can sort, search, and act on. Open it from the command palette with **Tag Visibility: Open the panel**.

- **Rules and presets** decide which tags are affected - by pattern, by how often a tag is used, or by an explicit list. (A preset is a ready-made rule, for example "hide hex color codes," that you switch on or off.)
- **Per-tag overrides** are your safety net: pin any single tag to always-show (or always-hide) ahead of every rule.
- **Scopes** are the four places it can act - the tag pane, the tag tree from Notebook Navigator (a separate, optional community plugin), Properties, and Autocomplete - each independently switchable.
- **Everything is reversible** - per tag, per scope, or all at once.

## What happens to a tag

This is what the plugin does to each tag internally (not a click-by-click guide; for that, see the [README Quick start](../README.md#quick-start)). For every tag it encounters, Tag Visibility:

1. **Reads** the tag and its stats (how often it is used, where). It never writes to your notes.
2. **Decides** what should happen, from your overrides and rules: show the tag, or hide it. (In preview mode, anything that *would* be hidden is highlighted in place instead, so you can see a rule's effect before committing.)
3. **Marks** the on-screen tag so the plugin's styling can hide or highlight it. The note, and Obsidian's own tag list, are left untouched.
4. **Undoes** cleanly on demand: switch off a scope, a rule, or the whole plugin, and the mark is removed. Your files never changed, so there is nothing to roll back.

Tag Visibility can always tell you *why* a tag is affected: every row in the panel names the exact preset, rule, or override responsible. A tag is never hidden without a traceable reason. If anything ever looks wrong, **Tag Visibility: Panic disable** removes every effect across every scope in a single action.

## Under the hood

*For engineers. The full reference, with the module map and sequence diagrams, lives in [ARCHITECTURE.md](ARCHITECTURE.md).*

**The prime directive: decorate, never mutate.** Every design choice follows from one rule - the plugin must not modify the vault's notes - so it works entirely at the rendered-DOM layer. To hide a tag, an observer adds a plugin-owned class (for example `.tag-curator-hidden`) to the rendered row, and CSS collapses it. (One nuance: Notebook Navigator's tree reserves each row's slot no matter what, so hidden rows there are dimmed and struck through in place rather than collapsed.) Nothing leaves the document model and no note is rewritten.

**Four layers:**

- **UI surfaces** - the places tags render (the four scopes: tag pane, Notebook Navigator tree, Properties pills, Autocomplete popup), plus the plugin's own Tag Visibility panel. The panel is where you manage tags; it is not itself a visibility scope.
- **Observers** - the *only* DOM-touching layer. One `ObserverBase` subclass per surface, each with a `MutationObserver` (watching `childList`, `subtree`, and `characterData`) and a `requestAnimationFrame`-coalesced apply loop. All cleanup is registered with Obsidian's `plugin.register(...)`, so observers disconnect on unload with no leaks.
- **Engine** - pure, DOM-free decision logic. Given a tag, its metadata, the active rules, and the overrides, it returns one decision.
- **Storage** - `data.json` (settings, rules, overrides) and `tags.json` (a derived per-tag metadata sidecar). Split deliberately to avoid write races.

`main.ts` wires the layers together and fans shared state out to every observer in one pass.

**How a decision is made:** the engine resolves show-versus-hide in strict precedence - always-show override, then always-hide override, then the highest-priority matching enabled rule, then the default (shown). Flagging is a rendering choice layered on top of that decision: the tag stays visible but highlighted in place rather than collapsed. Preview mode applies it to everything a rule would hide (so you can see the impact before committing), and a rule can use flag as its action to mark matched tags persistently. (How rule priority is assigned and tie-broken is detailed in [ARCHITECTURE.md](ARCHITECTURE.md#visibility-resolution).)

**Why it is safe to trust:** hiding is class-based, never DOM removal, so the node stays in the document. Panic disable directly disables every observer (each clears its own decoration), then brute-force sweeps the document for any straggler in the plugin's class namespaces, so it works even if a scope's observer is wedged. On unload, every observer detaches and the document is swept clean. And it never patches Obsidian's `metadataCache` - the in-memory index of tags, links, and frontmatter that powers search and queries - so Dataview, Tasks, and Bases, which read from that cache, always see your real, full tag set. This is verifiable, not a promise: every write the plugin makes targets its own two files (`data.json` and `tags.json`), and it calls no note-editing API at all - `vault.modify`, `fileManager.renameFile`, `processFrontMatter`, and the like are simply absent from the source. Renaming a tag, the one operation that edits notes, is delegated to the separate Tag Wrangler plugin and runs only on your explicit action.

**The honest dependency.** Because it decorates *rendered* rows, Tag Visibility depends on the DOM structure and CSS class names of Obsidian's surfaces (and of Notebook Navigator), which are not a guaranteed public API. An Obsidian update could change that markup and require a selector fix in the plugin. The core tag pane goes one step further: to release a hidden row's space immediately, the plugin re-measures affected rows through the pane's own virtualizer machinery - also not a public API, also feature-detected on every use; if it changes, the plugin silently falls back to letting the pane reclaim space on its next natural redraw. In every case the failure mode is cosmetic - a tag might not hide correctly or its space might linger - and never touches your notes; disabling the plugin restores everything.

## FAQ

### Everyday

**Will Tag Visibility change or delete my notes or tags?**
No, and this is built into the design rather than a policy it chooses to follow. Tag Visibility contains no code that writes to your notes: it never calls any of Obsidian's note-editing APIs (the ones that create, modify, rename, or delete files, or rewrite frontmatter). The only files it writes are its own two settings files in its plugin folder. The single action that can change a note, renaming a tag across your vault, it hands to the separate Tag Wrangler plugin, and only when you ask for it. Your Markdown files and Obsidian's tag data are otherwise untouched.

**If I hide a tag, is it gone?**
No. It is still in your notes and still in Obsidian's index, just not drawn in the places you chose. Show it again, or disable the plugin, and it reappears instantly.

**What happens if I disable or uninstall Tag Visibility?**
Every tag comes back immediately. Because nothing was ever written to your files, there is nothing to undo.

**I hid a tag by accident. How do I get it back?**
Open the Tag Visibility panel (run **Tag Visibility: Open the panel** from the command palette), find the tag's row, and pin it to **always-show** - it beats every rule. Or run **Tag Visibility: Panic disable** to clear all effects at once.

**Does it work on mobile?**
Yes. One rough edge: on a very large vault, a tag you have hidden may briefly flash into view while you scroll a long list, then disappear again as the plugin's next pass (a frame or so later) catches it. It is cosmetic and self-healing (see Known limitations in [CHANGELOG.md](../CHANGELOG.md)), and it never affects your notes.

**Does it send my data anywhere?**
No. Tag Visibility makes zero network requests and has no telemetry. Nothing is fetched, and nothing is sent.

**Will it slow down a large vault?**
It is built to stay light. It works in small batches tied to the screen's refresh, and it hides a tag by styling it rather than rebuilding the list. For typical vaults (under roughly 10,000 notes and 1,500 unique tags) you should not notice it running.

**Will it hide tags from Dataview, Tasks, or Bases?**
No. Those tools read Obsidian's own tag data, which Tag Visibility never touches. They see your full, real tag set; only the visual UI changes.

**Is it free?**
Yes. Tag Visibility is free and open source under the Apache 2.0 license.

**Where are my settings and rules stored?**
In your plugin folder, `.obsidian/plugins/tag-visibility/`, as `data.json` (settings, rules, overrides) and `tags.json` (per-tag stats). Both are plain JSON, separate from your notes.

### Under the hood

**Why decorate the DOM instead of filtering Obsidian's tag index?**
Filtering the index would leak hides into Dataview, Tasks, and Bases, and would risk irreversibility. Decorating the rendered rows keeps the metadata cache pristine, lets every consumer see the real tag set, and makes "disable" a clean revert. It is the design that makes "display-only, fully reversible" literally true.

**How does it survive Obsidian's virtualized panes?**
Obsidian recycles a small pool of row elements and rewrites their text as you scroll. Each surface's `MutationObserver` watches `characterData`, so when a recycled row's text changes the engine re-evaluates it and updates the decoration, clearing any class left over from the row's previous tag. Notebook Navigator adds a twist: it is React-rendered, and clicking a row makes React rewrite the row's classes in place - so the Notebook Navigator observer also watches class rewrites and re-applies its decoration within a frame. On extreme vaults a brief stale glyph can linger until the pane redraws; this is a tracked known limitation.

**How is show vs hide decided, and where does "flag" fit?**
Per row, in order: always-show override, then always-hide override, then the highest-priority matching enabled rule, then the default (shown). That chain decides show-versus-hide only. "Flag" is a separate display treatment - the tag stays visible but highlighted in place rather than collapsed - used by preview mode (to show what a rule would hide) and available as a rule action (a rule can flag its matches instead of hiding them). Rule-priority assignment and tie-breaking are detailed in [ARCHITECTURE.md](ARCHITECTURE.md#visibility-resolution).

**Where is state stored, and why two files?**
`data.json` holds schema-versioned settings, rules, and overrides, written through Obsidian's plugin-data API; migrations are one-way and guarded, and a file written by a newer plugin version is treated as read-only so it can never be downgraded. `tags.json` is a derived metadata sidecar (count, first and last seen, source), written on a debounce. They are split so frequent metadata updates never race settings writes. `tags.json` is derived, not a source of truth: if it is lost, **Tag Visibility: Rescan vault tags** rebuilds it. Settings edited on another device (via Obsidian Sync rewriting `data.json`) are detected and reapplied.

**Does it couple to Notebook Navigator's code?**
No. It detects Notebook Navigator at runtime and decorates its rendered tag rows from the outside (runtime interop only), a silent no-op when Notebook Navigator is absent. There is no source coupling: Notebook Navigator is GPL-3.0, Tag Visibility is Apache-2.0. (As with Obsidian's own surfaces, this is a dependency on rendered markup, not a public API - see "The honest dependency" above.)

**How do I see why a tag is affected?**
Every row in the panel answers "why is this affected?" by naming the exact preset, rule, or override. Nothing is hidden without a traceable cause.

**What does it deliberately not do?**
No note-content edits, no `metadataCache` patching, no tag coloring, no filtering of query results, and no telemetry. See [Non-goals](../README.md#non-goals).

## See also

- [README.md](../README.md) - install and full usage guide
- [ARCHITECTURE.md](ARCHITECTURE.md) - the engineering reference (layers, observers, diagrams)
- [CHANGELOG.md](../CHANGELOG.md) - released changes and known limitations
