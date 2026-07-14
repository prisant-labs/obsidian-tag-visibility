import { ObservedRow, ObserverBase, DecorationMode } from './observerBase';

// plugin-owned decoration for the autocomplete scope. Distinct from the
// tag pane (tag-curator-*), Notebook Navigator (tc-nn-*), and Properties
// (tc-prop-*) namespaces, so panic cleanup and the per-scope kill switch sweep
// this surface independently.
const HIDDEN_CLASS = 'tc-ac-hidden';
const FLAG_CLASS = 'tc-ac-flagged';
const MARK_CLASS = 'tc-ac-marked';
const RULE_ATTR = 'data-tc-ac-rule';

/**
 * VERSION-FRAGILE DOM CONTRACT (the reason the autocomplete scope has its own
 * kill switch). These selectors describe Obsidian's runtime editor suggestion
 * popup DOM; they are NOT in obsidian.d.ts and may drift between Obsidian
 * releases. The observer codes defensively: if a selector matches nothing,
 * findRows returns [] (no decoration) rather than throwing, so a structure
 * change degrades to a silent no-op, never a crash. If autocomplete suppression
 * ever stops working after an Obsidian update, the user can disable the scope
 * and these constants are the place to re-anchor.
 *
 *   - The suggestion popup is portaled (typically to document.body) as a
 *     `.suggestion-container`. It is TRANSIENT: created per keystroke and
 *     removed on dismiss. Unlike the tag pane / Properties (stable containers),
 *     we cannot observe the popup directly because it does not exist at init.
 *     Instead init() observes the stable portal root (document.body) for the
 *     popup APPEARING, then decorates whatever `.suggestion-container`s exist on
 *     each apply pass.
 *   - Each suggestion is a `.suggestion-item`; its visible text lives in
 *     `.suggestion-content` (falling back to the item's own textContent).
 *
 * DISTINGUISHING TAG SUGGESTIONS (three conservative signals). The SAME
 * `.suggestion-container` is reused for file links, headings, aliases, the
 * Properties tags field, and so on, so we must act ONLY on tag suggestions.
 * Three signals, any one sufficient:
 *
 *   1. LEGACY PREFIX: older Obsidian builds rendered tag suggestions with a
 *      leading '#' (e.g. `#draft`); file / heading / link suggestions never
 *      have one. An item whose trimmed text starts with '#' is a tag.
 *   2. TYPING CONTEXT (Obsidian 1.12.x): the core tag suggester now strips
 *      the leading '#' before rendering (its getSuggestions slices it off),
 *      so items are bare names and signal 1 never fires. Instead we read the
 *      active editor: if the text before the cursor ends in a '#token' that
 *      is NOT inside an unclosed wikilink (typing `[[note#head` opens the
 *      HEADING suggester), the open popup belongs to the tag suggester and
 *      every item in it is a tag. Uses only public Editor API surface
 *      (workspace.activeEditor.editor, getCursor, getLine), wrapped so any
 *      failure means "not a tag context" rather than a throw.
 *   3. PROPERTIES TAGS FIELD (H006): the Properties panel's own `tags` value
 *      picker renders through this SAME popup, but it is not the note-body
 *      editor signal 2 reads - so signal 2 only fired there by coincidence,
 *      whenever the body's last cursor position happened to also look like a
 *      '#token'. Instead we check whether the currently focused element
 *      (`document.activeElement`) sits inside the Properties tags row
 *      (`.metadata-property[data-property-key="tags"]`, mirroring
 *      PropertiesObserver's own selector). Unlike the body editor, that field
 *      never suggests anything but tags, so this signal alone is sufficient -
 *      no '#' heuristic needed. Wrapped so any failure reads as "not a tag
 *      context".
 *
 * All three signals are deliberately conservative: a suggestion we cannot
 * confirm is a tag is left untouched (we would rather miss suppressing a tag
 * than wrongly hide a file/heading suggestion).
 *
 * KEYBOARD-FOCUS CAVEAT (accepted for v1.0): hiding a suggestion item via CSS
 * `display:none` removes it visually, but Obsidian's own suggestion controller
 * still owns arrow-key navigation over its internal list. A suppressed item may
 * therefore remain reachable by keyboard (and selectable) even though it is not
 * shown. We intentionally do NOT delete or reorder DOM nodes (that would fight
 * the controller and risk breaking selection), so this is a known, acceptable
 * limitation: the goal is to discourage re-creating a just-hidden tag, not to
 * make it impossible.
 */
const SUGGESTION_CONTAINER_SELECTOR = '.suggestion-container';
const SUGGESTION_ITEM_SELECTOR = '.suggestion-item';
const SUGGESTION_CONTENT_SELECTOR = '.suggestion-content';
// Mirrors PropertiesObserver's own TAGS_PROPERTY_SELECTOR (H006, signal 3
// above). Duplicated rather than imported: each observer documents its own
// version-fragile DOM contract independently, and this is the one selector
// the two files need to agree on.
const PROPERTIES_TAGS_ROW_SELECTOR = '.metadata-property[data-property-key="tags"]';

interface EditorLike {
  getCursor(): { line: number; ch: number };
  getLine(line: number): string;
}

interface ObserverApp {
  workspace: {
    onLayoutReady: (cb: () => void) => void;
    on: (event: string, cb: () => void) => unknown;
    activeEditor?: { editor?: EditorLike } | null;
  };
}

/**
 * Suppresses hidden tags from Obsidian's editor tag-autocomplete dropdown so a
 * user does not immediately re-create a tag they just hid. Autocomplete is core
 * Obsidian, so unlike the Notebook Navigator observer this needs NO plugin
 * detection - it always attaches; the per-scope kill switch
 * (settings.scopeEnabled['autocomplete']) gates whether it is live.
 *
 * The shared rules / metadata / preview / enabled state and the
 * requestAnimationFrame-coalesced apply loop live in ObserverBase. This subclass
 * supplies only the autocomplete specifics:
 *   - observe a STABLE root (document.body) for the TRANSIENT popup appearing,
 *     because the `.suggestion-container` is created per keystroke and removed on
 *     dismiss (see the DOM-contract comment above),
 *   - read each TAG suggestion item's case-preserved text (only items whose text
 *     begins with '#'), trimmed,
 *   - toggle `tc-ac-hidden` / `tc-ac-flagged` and the `data-tc-ac-rule` marker,
 *     with ARIA handling that mirrors the other observers.
 *
 * It reuses the inherited resolveRow / visibility resolution unchanged: there is
 * no flat-nesting concern here (each suggestion is an independent item), so the
 * default RuleEngine resolution - including the always-show override that keeps
 * a suggestion visible despite a hide rule - is exactly right.
 */
export class AutocompleteObserver extends ObserverBase {
  init(): void {
    const app = this.app as unknown as ObserverApp;
    app.workspace.onLayoutReady(() => this.attachAll());
    this.plugin.registerEvent(
      app.workspace.on('layout-change', () => this.attachAll()) as never,
    );
  }

  /**
   * Observe the stable portal root (document.body) so that when a transient
   * `.suggestion-container` is added (per keystroke), the inherited childList +
   * subtree MutationObserver fires and the coalesced apply pass decorates it.
   * observeContainer is idempotent (deduped by WeakMap), so repeated calls on
   * layout-change are safe. We deliberately watch the body rather than each
   * popup because the popup does not exist at init and is recreated constantly;
   * a single body observer is simpler and the apply pass is cheap (it only ever
   * scans the small set of currently-open suggestion popups - see apply()).
   *
   * Defensive: in a non-DOM context (no document/body) this is a no-op rather
   * than a throw, so the observer degrades safely.
   */
  attachAll(): void {
    if (typeof document === 'undefined' || !document.body) return;
    this.observeContainer(document.body);
  }

  /**
   * Read the TAG suggestion items within whatever suggestion popups exist under
   * `root` (root is the observed body). We scope strictly to
   * `.suggestion-container` so we never touch unrelated DOM, and within it to
   * `.suggestion-item`s whose text begins with '#'. A popup with no tag items,
   * or no popup at all, yields []: no throw, no decoration.
   *
   * Perf: this runs only on an apply pass (mutation-triggered, rAF-coalesced),
   * and only ever scans the items inside currently-open suggestion popups -
   * normally zero, and a few dozen at most while a popup is open - so the body
   * observer's apply cost is bounded by the popup contents, not the whole page.
   */
  /**
   * True when the active editor's cursor sits at the end of a '#token' that is
   * not inside an unclosed wikilink - i.e. the open suggestion popup belongs
   * to the core tag suggester and its (bare-name) items are tags. Any missing
   * piece (no active editor, no cursor, host API drift) reads as false: not a
   * tag context, leave the popup untouched.
   */
  private isTagTypingContext(): boolean {
    try {
      const app = this.app as unknown as ObserverApp;
      const editor = app.workspace.activeEditor?.editor;
      if (!editor) return false;
      const cursor = editor.getCursor();
      const before = editor.getLine(cursor.line).slice(0, cursor.ch);
      // `[[note#head` opens the HEADING suggester; never treat it as tags.
      if (/\[\[[^\]]*$/.test(before)) return false;
      return /#[^\s#]*$/.test(before);
    } catch {
      return false;
    }
  }

  /**
   * True when the currently focused element (H006, signal 3) sits inside the
   * Properties `tags` row - i.e. the open suggestion popup belongs to that
   * field's own value picker, which never suggests anything but tags. Any
   * failure (no activeElement, DOM shape drift) reads as false: not a tag
   * context, leave the popup untouched.
   */
  private isPropertiesTagsFieldFocused(): boolean {
    try {
      return !!document.activeElement?.closest(PROPERTIES_TAGS_ROW_SELECTOR);
    } catch {
      return false;
    }
  }

  protected findRows(root: HTMLElement): ObservedRow[] {
    const containers = root.querySelectorAll<HTMLElement>(
      SUGGESTION_CONTAINER_SELECTOR,
    );
    const out: ObservedRow[] = [];
    // Resolved once per pass: with a popup open, the editor/focus state is
    // stable for the duration of the pass.
    const inTagContext = this.isTagTypingContext() || this.isPropertiesTagsFieldFocused();
    for (const container of Array.from(containers)) {
      const items = container.querySelectorAll<HTMLElement>(
        SUGGESTION_ITEM_SELECTOR,
      );
      for (const item of Array.from(items)) {
        const contentEl = item.querySelector(SUGGESTION_CONTENT_SELECTOR) ?? item;
        const text = (contentEl.textContent ?? '').trim();
        if (!text) continue;
        // Signal 1 (legacy prefix) or signal 2 (typing context) - see the
        // DOM-contract comment above. Pass the text case-preserved (trim
        // only); the base apply() strips a leading '#'. The engine is
        // CASE-SENSITIVE, so we must NOT lowercase - that would make the same
        // tag behave differently in autocomplete vs the tag pane.
        if (!text.startsWith('#') && !inTagContext) continue;
        out.push({ el: item, tag: text });
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
