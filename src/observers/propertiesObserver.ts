import { ObservedRow, ObserverBase, DecorationMode } from './observerBase';

// plugin-owned decoration for the Properties scope. Distinct from the tag
// pane (tag-curator-*) and Notebook Navigator (tc-nn-*) namespaces, so panic
// cleanup and the per-scope kill switch can sweep this surface independently.
const HIDDEN_CLASS = 'tc-prop-hidden';
const FLAG_CLASS = 'tc-prop-flagged';
const MARK_CLASS = 'tc-prop-marked';
const RULE_ATTR = 'data-tc-prop-rule';

/**
 * VERSION-FRAGILE DOM CONTRACT (the reason the Properties scope has its own
 * kill switch). These selectors describe Obsidian's runtime Properties /
 * metadata editor DOM; they are NOT in obsidian.d.ts and may drift between
 * Obsidian releases. The observer codes defensively against drift: if any of
 * these selectors match nothing, findRows returns [] (no decoration) rather
 * than throwing, so a structure change degrades to a silent no-op, never a
 * crash. If the Properties scope ever stops working after an Obsidian update,
 * the user can disable the scope and these constants are the place to re-anchor.
 *
 *   - The metadata editor container: `.metadata-container` (it wraps the
 *     `.metadata-properties` list). The editor appears in the open file view
 *     and in the dedicated File Properties leaf.
 *   - The tags property row: `.metadata-property[data-property-key="tags"]`.
 *     We scope strictly to this row, so a non-tags property (author, aliases,
 *     a custom field whose value equals a hidden tag name) is NEVER decorated.
 *   - Each tag value renders as a multi-select pill: `.multi-select-pill` with
 *     the tag text in `.multi-select-pill-content`. We strip nothing here beyond
 *     trimming; the base apply() strips a leading '#'. The engine, tagMeta keys,
 *     and matchers are CASE-SENSITIVE (tags keep the case written in the vault),
 *     so we pass case-preserved text identically to the tag-pane observer for
 *     consistent cross-surface behavior.
 */
const METADATA_CONTAINER_SELECTOR = '.metadata-container';
const TAGS_PROPERTY_SELECTOR = '.metadata-property[data-property-key="tags"]';
const PILL_SELECTOR = '.multi-select-pill';
const PILL_CONTENT_SELECTOR = '.multi-select-pill-content';

/**
 * Decorates the tag pills in Obsidian's core Properties panel (the metadata
 * editor's `tags` property row). Properties is core Obsidian, so unlike the
 * Notebook Navigator observer this needs NO plugin detection - it always
 * attaches; the per-scope kill switch (settings.scopeEnabled['properties'])
 * gates whether it is live.
 *
 * The shared MutationObserver + requestAnimationFrame lifecycle lives in
 * ObserverBase. This subclass supplies only the Properties specifics:
 *   - discover `.metadata-container` editors in the workspace and re-attach on
 *     layout-change (the editor mounts/unmounts as files open),
 *   - read each tag pill's text from the `tags` property row ONLY,
 *   - toggle `tc-prop-hidden` / `tc-prop-flagged` and the `data-tc-prop-rule`
 *     marker, with ARIA handling that mirrors the tag pane.
 *
 * It reuses the inherited resolveRow / visibility resolution unchanged: there
 * is no flat-nesting concern here (Properties lists tags as independent pills,
 * not a tree), so the default RuleEngine resolution is exactly right.
 */
export class PropertiesObserver extends ObserverBase {
  init(): void {
    this.app.workspace.onLayoutReady(() => this.attachAll());
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => this.attachAll()),
    );
  }

  attachAll(): void {
    // The metadata editor is not addressable by a single leaf view type the way
    // the tag pane / NN panes are (it is embedded in markdown file views and in
    // the File Properties leaf). Discover every editor in the document by its
    // stable container class. Defensive: a missing container yields no panes and
    // observeContainer is simply never called.
    const containers = document.querySelectorAll<HTMLElement>(
      METADATA_CONTAINER_SELECTOR,
    );
    for (const container of Array.from(containers)) {
      this.observeContainer(container);
    }
  }

  protected findRows(root: HTMLElement): ObservedRow[] {
    // Scope strictly to the tags property row(s). A root that contains no tags
    // property (selector drift, or a file with no tags) yields []: no throw, no
    // decoration. We deliberately never query pills outside this row, so other
    // properties (author, aliases, custom fields) are untouched even when their
    // value text equals a hidden tag name.
    const tagsRows = root.querySelectorAll<HTMLElement>(TAGS_PROPERTY_SELECTOR);
    const out: ObservedRow[] = [];
    for (const tagsRow of Array.from(tagsRows)) {
      const pills = tagsRow.querySelectorAll<HTMLElement>(PILL_SELECTOR);
      for (const pill of Array.from(pills)) {
        const contentEl = pill.querySelector(PILL_CONTENT_SELECTOR) ?? pill;
        // Pass case-preserved text. The base apply() strips a leading '#' before
        // lookup. The engine and matchers are CASE-SENSITIVE, so we must not
        // lowercase here - that would make the same tag behave differently in
        // Properties vs the tag pane.
        const text = (contentEl.textContent ?? '').trim();
        out.push({ el: pill, tag: text });
      }
    }
    return out;
  }

  protected applyDecoration(
    el: HTMLElement,
    ruleId: string,
    mode: DecorationMode,
  ): void {
    el.classList.toggle(HIDDEN_CLASS, mode === 'hidden');
    el.classList.toggle(FLAG_CLASS, mode === 'flagged');
    el.classList.toggle(MARK_CLASS, mode === 'marked');
    if (mode === 'hidden') el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
    el.setAttribute(RULE_ATTR, ruleId);
  }

  protected clearDecoration(el: HTMLElement): void {
    el.classList.remove(HIDDEN_CLASS, FLAG_CLASS, MARK_CLASS);
    el.removeAttribute('aria-hidden');
    el.removeAttribute(RULE_ATTR);
  }

  protected findDecorated(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}, .${FLAG_CLASS}, .${MARK_CLASS}`),
    );
  }
}
