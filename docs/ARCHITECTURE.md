# Architecture

Tag Visibility is a **display-only** Obsidian plugin: it changes how tags *render* across Obsidian's UI by toggling CSS classes on existing DOM nodes, and it never edits note content. Disabling or uninstalling it restores every tag. This document is the canonical reference for how the plugin is built. For a plain-language explanation of how it works (with an FAQ for users and engineers), start with [HOW-IT-WORKS.md](HOW-IT-WORKS.md); for the contributor workflow see [CONTRIBUTING.md](../CONTRIBUTING.md).

## The prime directive: decorate, never mutate

Every architectural choice follows from one rule: **the plugin must not modify the vault's notes.** It therefore works entirely at the rendered-DOM layer. To hide a tag, an observer adds a plugin-owned class (for example `.tag-curator-hidden`) to the rendered row, and a CSS rule collapses it with `display: none`. (Notebook Navigator's tree is the one exception: its virtualizer reserves each row's slot regardless, so hidden rows there are dimmed and struck through in place instead of collapsed - see Virtualization below.) Nothing is removed from the document model, no note is rewritten, and the only persisted state is the plugin's own config plus a metadata sidecar. That single constraint is what makes the plugin fully reversible.

## Layers

```mermaid
flowchart TB
    subgraph Surfaces["UI surfaces (host DOM)"]
        TP[Native tag pane]
        NN[Notebook Navigator tree]
        PR[Properties pills]
        AC[Autocomplete popup]
        WS[Tag Visibility panel + Settings]
    end
    subgraph Observers["Observer layer (the only DOM-touching layer)"]
        OB[ObserverBase]
        TPO[TagPaneObserver]
        NNO[NotebookNavigatorObserver]
        PRO[PropertiesObserver]
        ACO[AutocompleteObserver]
    end
    subgraph Engine["Engine (pure, DOM-free)"]
        RE[RuleEngine]
        TM[TagMatcher]
        PS[presets / resolveActiveRules]
    end
    subgraph Storage["Storage"]
        SM[SettingsManager -> data.json]
        TMM[TagMetaManager -> tags.json]
    end
    MAIN[main.ts orchestrator]

    MAIN --> Observers
    MAIN --> Storage
    TPO --> TP
    NNO --> NN
    PRO --> PR
    ACO --> AC
    WS --> MAIN
    Observers --> Engine
    Engine --> Storage
```

Four layers, plus the orchestrator:

- **UI surfaces** - the places tags appear: the native tag pane, Notebook Navigator's tag tree, Properties pills, the editor autocomplete popup, and the plugin's own Tag Visibility panel and Settings tab.
- **Observer layer** - one `ObserverBase` subclass per host surface. Each watches its surface for tag rows and toggles decoration classes. This is the only layer that touches host DOM it does not own.
- **Engine** - pure, DOM-free decision logic. Given a tag, its metadata, the active rules, and the per-tag overrides, it decides whether the tag is shown, hidden, or flagged.
- **Storage** - `SettingsManager` (rules, scope kill switches, per-tag overrides; persisted to `data.json`) and `TagMetaManager` (per-tag count, first seen, last seen, source; persisted to `tags.json`).

`main.ts` wires the layers together and fans shared state out to every observer in one pass.

## Module map

```
src/
  main.ts                       # Orchestrator: lifecycle, command registration, state fan-out
  types.ts                      # Rule, MatchCriteria, TagMeta, TagOverride, Scope, Mode
  engine/                       # Pure decision logic (no DOM, no Obsidian UI)
    matchers.ts                 # TagMatcher: regex / frequency / list matching (+ regex cache)
    ruleEngine.ts               # resolveVisibility, isEffectivelyHidden, countCurated
    presets.ts                  # Built-in presets + resolveActiveRules(settings)
  observers/                    # DOM decoration, one subclass per surface
    observerBase.ts             # Shared lifecycle (MutationObserver, rAF apply, registry)
    tagPaneObserver.ts          # .tag-pane-tag rows
    notebookNavigatorObserver.ts# .nn-tag rows (runtime interop only)
    propertiesObserver.ts       # .multi-select-pill tag pills
    autocompleteObserver.ts     # .suggestion-item tag suggestions
  storage/
    settings.ts                 # SettingsManager: schema-versioned settings + migrations
    tagMeta.ts                  # TagMetaManager: the tags.json sidecar
  integrations/                 # Runtime detection + interop (no source coupling)
    notebookNavigator.ts        # detect + reapply subscription
    notebookNavigatorApi.ts
  ui/
    settingsTab.ts              # Tabbed settings (General, All tags, Scopes, Presets, ...)
    ruleEditor.ts               # Card-based rule editor + live preview
    stateBanner.ts              # Persistent non-default-state banner
    welcomeModal.ts             # First-run onboarding
    panicDisable.ts             # Brute-force DOM sweep across all scopes
    curationWorkspace/          # The dockable Tag Visibility panel + virtualized table
    tagList/                    # Shared tag-table model + actions (pane and settings)
  util/
    safeRegex.ts                # iOS-safe regex compile (rejects lookbehind)
    tagUtils.ts
styles.css                      # All styling (Obsidian theme variables only; no hardcoded colors)
```

## Visibility resolution

For each tag row, the engine resolves a single decision. Per-tag overrides win over rules, and an always-show override is the ultimate safety net.

```mermaid
flowchart TD
    A[Tag row discovered] --> B[Normalize tag, look up metadata]
    B --> C{always-show override?}
    C -->|yes| V[Shown: clear decoration]
    C -->|no| D{always-hide override?}
    D -->|yes| P{preview mode?}
    D -->|no| E{highest-priority enabled rule matches?}
    E -->|no| V
    E -->|"yes (action: hide)"| P
    P -->|no| H[Hidden: add .tag-curator-hidden]
    P -->|yes| F[Flagged: add .tag-curator-flagged]
```

Precedence, exactly as `RuleEngine.resolveVisibility` implements it:

1. **always-show override** beats everything (the safety net: the user can always force a tag visible).
2. **always-hide override** beats every rule, but yields to always-show.
3. **Rules** otherwise decide. Enabled rules are sorted by `priority` descending and the **highest-priority match wins**.
4. **Preview mode** is a display transform applied last: anything that would be hidden is instead *flagged* (highlighted in place), so the user can see a rule's impact before committing.

## The observer pattern

All four surfaces share one base class. `ObserverBase` owns the generic machinery; each subclass supplies only its surface specifics.

```mermaid
classDiagram
    class ObserverBase {
        <<abstract>>
        +setRules(rules)
        +setMetadata(meta)
        +setOverrides(overrides)
        +setPreviewMode(on)
        +setEnabled(on)
        #observeContainer(el)
        #apply(root)
        #findRows(root) ObservedRow[]
        #applyDecoration(el, ruleId, mode)
        #clearDecoration(el)
        #findDecorated(root) HTMLElement[]
    }
    ObserverBase <|-- TagPaneObserver
    ObserverBase <|-- NotebookNavigatorObserver
    ObserverBase <|-- PropertiesObserver
    ObserverBase <|-- AutocompleteObserver
```

The base owns: a registry of observed containers, a `MutationObserver` per container (watching `childList`, `subtree`, and `characterData`), a `requestAnimationFrame`-coalesced apply loop, the shared rules / metadata / overrides / preview / enabled state, and clear-on-disable plus unload cleanup. Every container is registered with `plugin.register(...)` so its observer disconnects automatically on unload (zero leaks).

| Observer | Host selector | Hide class | Detection |
|---|---|---|---|
| `TagPaneObserver` | `.tag-pane-tag` | `.tag-curator-hidden` | core (always on) |
| `PropertiesObserver` | `.multi-select-pill` | `.tc-prop-hidden` | core (always on) |
| `AutocompleteObserver` | `.suggestion-item` | `.tc-ac-hidden` | core (always on) |
| `NotebookNavigatorObserver` | `.nn-tag` | `.tc-nn-hidden` | runtime-detected; silent no-op if NN absent or too old |

Each scope has an independent kill switch, so a single misbehaving surface can be turned off without disabling the plugin. The effective enabled state of a scope is `globalEnable AND scopeKillSwitch`.

Two surfaces override pieces of the base contract:

- **Notebook Navigator watches class-attribute mutations.** NN is React-rendered: selecting a row makes React rewrite the row's `className` from its own vDOM, wiping the `tc-nn-*` classes in place - an attribute-only mutation that `childList`/`characterData` watching never sees. `NotebookNavigatorObserver` overrides the base's `observerInit()` hook to add `attributes: true, attributeFilter: ['class']`, and its decorate path uses strictly idempotent writes (every class/attribute write is guarded on the current value). That guard is load-bearing: `setAttribute` queues a mutation record even when the value is unchanged, so an unguarded write under attribute watching would re-trigger the observer forever. A re-decoration pass over an already-correct tree is mutation-silent.
- **Autocomplete detects tag suggestions by typing context.** Obsidian 1.12.x's tag suggester strips the leading `#` before rendering, so items are bare names and the legacy "text starts with `#`" signal never fires there. The observer's second signal reads the active editor: if the text before the cursor ends in a `#token` that is not inside an unclosed wikilink (`[[note#head` opens the heading suggester, which must never be touched), the open popup belongs to the tag suggester and its items are tags. Public Editor API only, wrapped so any failure reads as "not a tag context"; the legacy `#`-prefix signal is kept for older builds.

## Decoration lifecycle

```mermaid
sequenceDiagram
    participant MC as metadataCache
    participant Main as main.ts
    participant Obs as ObserverBase
    participant Eng as RuleEngine
    participant DOM as Tag DOM

    MC->>Main: 'resolved' / 'changed'
    Main->>Obs: setMetadata() / attachAll()
    Obs->>Obs: scheduleApply() (rAF-coalesced)
    Obs->>DOM: findRows()
    loop each row
        Obs->>Eng: resolveVisibility(tag, meta, rules, overrides)
        Eng-->>Obs: effective attribution
        alt would hide
            Obs->>DOM: add .tag-curator-hidden (or -flagged in preview)
        else
            Obs->>DOM: clearDecoration()
        end
    end
```

## State fan-out

`main.ts` subscribes to `settingsManager.onChange`. On any settings change it recomputes the active rule set (`resolveActiveRules`) and pushes rules, overrides, and preview mode to **every** observer in one loop, then applies each scope's effective enabled state and refreshes the status bar. The same fan-out runs from `onExternalSettingsChange` so an Obsidian Sync rewrite of `data.json` is handled cleanly. The status-bar count comes from the engine (`countCurated`) over tag metadata, not from any one scope's DOM, so toggling a scope off never changes the number.

## Storage

Two files, deliberately split to avoid write races:

- **`data.json`** (`SettingsManager`) - schema-versioned settings: rules, enabled presets, scope kill switches, per-tag overrides, preview/enabled flags, pane state. Migrations are one-way, additive, and guarded; writes go through Obsidian's plugin-data API (`Plugin.saveData`), and a file written by a newer plugin version is treated as read-only so an older build can never downgrade it.
- **`tags.json`** (`TagMetaManager`) - the tag-metadata sidecar: count, first seen, last seen, and source per tag. Writes are debounced (default 5000 ms) to avoid disk churn while editing. This is the plugin's own derived index, not note content.

## Reversibility and safety

- **Class-based hiding only.** Hiding is a CSS class plus a `display: none` rule, never DOM removal. The node stays in the document; the plugin just styles it.
- **Panic disable.** `panicDisable()` directly disables every observer (each clears its own decoration), then brute-force sweeps the whole document for any straggler in all four class namespaces, then flips the master enable off. It works even if a scope's observer is wedged.
- **`onunload`.** Every observer unloads, the metadata manager unloads, and `panicCleanup(document)` sweeps the document, so nothing survives an uninstall.

## Virtualization

Obsidian virtualizes large surfaces (the tag pane and Notebook Navigator's tree) by recycling a small pool of row elements and mutating their text in place as you scroll. Two consequences shape the design:

1. The shared `MutationObserver` watches `characterData`, so when a recycled row's text changes the observer re-evaluates and re-decorates it. Without this a recycled row would keep the prior tag's decoration.
2. Virtualizers position rows from a cached height model, not from the DOM alone, so hiding a row via CSS leaves its modeled height behind - an invisible row whose space stays reserved. `TagPaneObserver` therefore runs a **model-DOM coherence sweep** after every apply pass: any row whose display state disagrees with the pane's cached `info.hidden` is re-measured through the pane's own `measure()`, then the virtual display refreshes once. The sweep is idempotent (coherent rows are skipped, so passes converge instead of ping-ponging with the host) and feature-detects undocumented internals verified on Obsidian 1.12.7; if those internals ever drift, it silently stands down and the pane reclaims space on its next natural redraw. Notebook Navigator's virtualizer commits row offsets up front inside a fixed-height container and cannot be re-measured from outside, which is why its hidden rows dim in place instead of collapsing. Residual cosmetics (a brief stale glyph or blank region until the next pass) are listed under Known limitations in [CHANGELOG.md](../CHANGELOG.md).

## See also

- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) - plain-language explanation of how the plugin works, with an FAQ
- [CONTRIBUTING.md](../CONTRIBUTING.md) - dev setup, the verification gate, and contribution rules
- [CHANGELOG.md](../CHANGELOG.md) - released changes and known limitations
- [docs/decisions/](decisions/) - architecture decision records (ADRs)
