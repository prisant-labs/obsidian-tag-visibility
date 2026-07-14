import { RuleAttribution, TagMeta } from '../types';
import { DecorationMode, ObservedRow, ObserverBase } from './observerBase';

// plugin-owned decoration. These never collide with NN's nn-* namespace
// and are the only classes/attrs this observer adds or removes.
const HIDDEN_CLASS = 'tc-nn-hidden';
const FLAG_CLASS = 'tc-nn-flagged';
const MARK_CLASS = 'tc-nn-marked';
const RULE_ATTR = 'data-tc-nn-rule';

// Notebook Navigator's leaf view type. Used for getLeavesOfType; if NN ever
// renames it, the .nn-navigation-pane DOM fallback in attachAll still finds the
// pane (findings Section 5, Approach A).
const NN_VIEW_TYPE = 'notebook-navigator-view';

// NN DOM contract (runtime interop only; facts about a running instance, not
// copied source). findings Section 1, spec Section 5.1.
const NN_PANE_SELECTOR = '.nn-navigation-pane';
const NN_SCROLLER_SELECTOR = '.nn-navigation-pane-scroller[data-pane="navigation"]';
const NN_TAG_ROW_SELECTOR = '.nn-tag[data-tag]';

interface NnLeafView {
  containerEl?: HTMLElement;
}

interface NnLeaf {
  view?: NnLeafView;
  isDeferred?: boolean;
  loadIfDeferred?: () => void;
}

/**
 * Decorates Notebook Navigator's tag tree (`.nn-navitem.nn-tag[data-tag]` rows)
 * with Tag Visibility's hide/flag rules at runtime. GPL boundary: this is runtime
 * interop only - it observes and mutates NN's rendered DOM via stable data-*
 * attributes and adds only `tc-nn-*` classes. It never imports NN source and
 * never touches NN's own `nn-*` classes or settings.
 *
 * The shared MutationObserver + requestAnimationFrame lifecycle lives in
 * ObserverBase. This subclass supplies the NN specifics:
 *   - discover NN panes and observe the inner virtualized scroller,
 *   - read each row's canonical lowercase tag from `data-tag`,
 *   - toggle `tc-nn-hidden` / `tc-nn-flagged` and the `data-tc-nn-rule` marker,
 *   - the flat-nesting descendant match (a rule on `photo` also hits
 *     `photo/camera`), since NN renders nested tags as flat sibling rows.
 *
 * Because NN's tree is virtualized, rows scrolled out of view lose their DOM
 * node and come back fresh and undecorated. The inherited MutationObserver on
 * the scroller re-runs the idempotent decorate pass to re-assert state.
 */
export class NotebookNavigatorObserver extends ObserverBase {
  // NN writes `data-tag` as a lowercase canonical path, but the engine and the
  // metadata map are CASE-SENSITIVE (tags keep the vault's original casing).
  // Without reconciliation a mixed-case tag like `MyProject` decorates in every
  // surface EXCEPT NN, whose row carries `data-tag="myproject"`: the metadata
  // lookup misses (map key is `MyProject`) and a rule written `MyProject` never
  // matches `myproject` (DA-14). This index maps each metadata key's lowercase
  // form back to its canonical casing; findRows resolves every NN row through it
  // so the shared apply loop sees the same string the tag pane does. Rebuilt in
  // setMetadata (below) so it costs O(tags) per metadata change, not per row.
  private lowerToCanonical = new Map<string, string>();

  init(): void {
    this.app.workspace.onLayoutReady(() => this.attachAll());
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => this.attachAll()),
    );
  }

  /**
   * Rebuild the lowercase -> canonical-case index alongside the base metadata
   * store (DA-14). If two genuinely distinct tags collide on lowercase (e.g.
   * both `MyProject` and `myproject` exist as separate case-sensitive metadata
   * entries), last write wins - NN merges them into one lowercase row anyway,
   * so it cannot distinguish them and either canonical resolution is defensible.
   */
  setMetadata(metadata: Map<string, TagMeta>): void {
    super.setMetadata(metadata);
    const index = new Map<string, string>();
    for (const key of metadata.keys()) index.set(key.toLowerCase(), key);
    this.lowerToCanonical = index;
  }

  attachAll(): void {
    const leaves = this.app.workspace.getLeavesOfType(NN_VIEW_TYPE) as NnLeaf[];
    if (leaves.length > 0) {
      for (const leaf of leaves) this.attachLeaf(leaf);
      return;
    }
    // Fallback: NN's view type is unknown to us or unchanged - find panes by
    // their stable container class instead (findings Section 5, Approach A).
    const panes = document.querySelectorAll<HTMLElement>(NN_PANE_SELECTOR);
    for (const pane of Array.from(panes)) this.attachScrollerWithin(pane);
  }

  private attachLeaf(leaf: NnLeaf): void {
    if (leaf.isDeferred) leaf.loadIfDeferred?.();
    const containerEl = leaf.view?.containerEl;
    if (!containerEl) return;
    this.attachScrollerWithin(containerEl);
  }

  /**
   * Observe NN's inner scroll container (not the outer pane): that is the
   * element TanStack mounts/unmounts rows into, so it is what must be watched.
   * If the scroller is not present yet, fall back to the pane root so we still
   * catch rows once NN renders them.
   */
  private attachScrollerWithin(root: HTMLElement): void {
    // Prefer the inner scroller; fall back to the root itself so we still catch
    // rows if NN has not rendered the scroller wrapper yet.
    const scroller =
      root.querySelector<HTMLElement>(NN_SCROLLER_SELECTOR) ?? root;
    this.observeContainer(scroller);
  }

  /**
   * NN is React-rendered: clicking or selecting a row makes React rewrite the
   * row's className from its own vDOM, wiping the tc-nn-* classes IN PLACE -
   * an attribute mutation that childList/characterData watching never sees,
   * so the wiped row stayed undecorated until some unrelated DOM churn.
   * Watch class attribute mutations too, so a wipe triggers a re-apply pass.
   * Loop-safe: the filter surfaces only class changes, and classList.toggle
   * emits no mutation record when the class is already in the desired state,
   * so a re-decoration pass over an already-correct tree is mutation-silent.
   */
  protected observerInit(): MutationObserverInit {
    return {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    };
  }

  protected findRows(root: HTMLElement): ObservedRow[] {
    const rows = root.querySelectorAll<HTMLElement>(NN_TAG_ROW_SELECTOR);
    return Array.from(rows).map((row) => {
      // data-tag is NN's canonical LOWERCASE path (no leading '#'). Resolve it
      // back to the vault's actual casing so the case-sensitive metadata lookup
      // and rule matching in the shared apply loop behave exactly as they do in
      // the tag pane (DA-14). Fall back to the raw value when the tag is not in
      // metadata (e.g. no scan yet), which keeps all-lowercase vaults unchanged.
      const dataTag = row.getAttribute('data-tag') ?? '';
      return { el: row, tag: this.toCanonical(dataTag) };
    });
  }

  /**
   * Resolve any-case tag path to its canonical metadata casing (DA-14). Keys in
   * the index are lowercase, so the input is lowercased first: this makes the
   * helper correct for NN's already-lowercase data-tag AND for a mixed-case
   * ancestor prefix derived from splitting a canonical path. Unknown tags return
   * unchanged.
   */
  private toCanonical(tag: string): string {
    return this.lowerToCanonical.get(tag.toLowerCase()) ?? tag;
  }

  /**
   * Flat-nesting descendant match. NN renders `photo` and `photo/camera` as
   * separate sibling rows, so hiding the parent does not structurally hide the
   * child. We first resolve the row's own tag; if nothing applies to it, we
   * walk its ancestor prefixes (`photo/camera` -> `photo`) and inherit the
   * nearest ancestor that resolves to a hide. The row's own resolution always
   * wins for itself - including an always-show override, which keeps the
   * descendant visible despite an ancestor hide (spec Section 5.1).
   */
  protected resolveRow(tag: string, meta: TagMeta | undefined): RuleAttribution {
    const own = super.resolveRow(tag, meta);
    if (own.effective !== null) return own;

    // Perf note: each iteration calls RuleEngine.resolveVisibility - O(rules)
    // per ancestor - so the walk is O(ancestorDepth * ruleCount) per row.
    // This is acceptable at realistic NN scale (shallow tag trees, modest rule
    // counts). Intentionally NOT memoized to keep the observer simple; a
    // per-apply-pass cache is the right future optimization if depth or rule
    // counts grow materially (YAGNI).
    for (const rawAncestor of ancestorPrefixes(tag)) {
      // The prefix is derived by splitting the (already canonical) full tag, but
      // a standalone ancestor may be stored under different casing; resolve it
      // through the same index so its metadata + rule matching are case-correct
      // (DA-14).
      const ancestor = this.toCanonical(rawAncestor);
      const ancestorMeta = this.metadata.get(ancestor);
      const resolved = super.resolveRow(ancestor, ancestorMeta);
      const { effective } = resolved;
      // Inherit the ancestor's effective result only when it is NOT an
      // always-show override: a rule hide or an always-hide override propagates
      // down to this descendant, but an ancestor always-show pin governs only
      // that ancestor row and must NOT propagate to its descendants.
      if (effective !== null && effective.overrideReason !== 'always-show') {
        return resolved;
      }
    }
    return own;
  }

  /**
   * IDEMPOTENT WRITES ONLY. Because this observer watches attribute mutations
   * (observerInit above), every write in the decorate path must be a true
   * no-op when the DOM is already in the desired state - a write that fires a
   * mutation record on an unchanged value (setAttribute does, per spec) would
   * re-trigger the observer forever. Guarding on the current value makes a
   * re-decoration pass over an already-correct tree mutation-silent under any
   * MutationObserver implementation.
   */
  private setClass(el: HTMLElement, cls: string, on: boolean): void {
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }

  private setAttr(el: HTMLElement, name: string, value: string): void {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  private removeAttr(el: HTMLElement, name: string): void {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  }

  protected applyDecoration(
    el: HTMLElement,
    ruleId: string,
    mode: DecorationMode,
  ): void {
    this.setClass(el, HIDDEN_CLASS, mode === 'hidden');
    this.setClass(el, FLAG_CLASS, mode === 'flagged');
    this.setClass(el, MARK_CLASS, mode === 'marked');
    // Hidden NN rows are dimmed + struck through, not display:none (NN's
    // committed-offset virtualizer would keep the empty slot anyway), so they
    // remain visible interactive content and must never be aria-hidden. The
    // removal also cleans the attribute off rows decorated by older builds
    // that hid via display:none.
    this.removeAttr(el, 'aria-hidden');
    this.setAttr(el, RULE_ATTR, ruleId);
  }

  protected clearDecoration(el: HTMLElement): void {
    this.setClass(el, HIDDEN_CLASS, false);
    this.setClass(el, FLAG_CLASS, false);
    this.setClass(el, MARK_CLASS, false);
    this.removeAttr(el, 'aria-hidden');
    this.removeAttr(el, RULE_ATTR);
  }

  protected findDecorated(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}, .${FLAG_CLASS}, .${MARK_CLASS}`),
    );
  }
}

/**
 * Ancestor tag prefixes of a canonical path, nearest first. For `a/b/c` ->
 * ['a/b', 'a']. Returns [] for a top-level tag with no slash.
 */
function ancestorPrefixes(tag: string): string[] {
  const segments = tag.split('/');
  const out: string[] = [];
  for (let i = segments.length - 1; i > 0; i--) {
    out.push(segments.slice(0, i).join('/'));
  }
  return out;
}
