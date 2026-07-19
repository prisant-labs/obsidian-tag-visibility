import { App, Plugin } from 'obsidian';
import { Rule, RuleAttribution, TagMeta, TagOverride } from '../types';
import { Decoration, RuleEngine } from '../engine/ruleEngine';

/**
 * Shared lifecycle for DOM observers that decorate tag rows in some host surface
 * (Obsidian's core tag pane, Notebook Navigator's tag tree, and so on).
 *
 * The base owns the generic machinery: a registry of observed containers, the
 * MutationObserver wiring, a requestAnimationFrame-coalesced apply loop, the
 * shared rules / metadata / previewMode / enabled state, and clear/unload.
 * Subclasses supply only the surface-specific pieces:
 *   - init(): discover containers (and any reattachment triggers) and call
 *     observeContainer() for each.
 *   - findRows(root): locate the tag rows and read each row's raw tag text.
 *   - applyDecoration(el, ruleId, mode): mark a row hidden or flagged.
 *   - clearDecoration(el): remove any decoration from a row.
 *   - findDecorated(root): the rows currently decorated (used to clear).
 */
export interface ObservedRow {
  el: HTMLElement;
  tag: string;
}

// The decoration a row can carry. Equals the engine's Decoration decision so the
// observer and the engine never drift; null (shown) is handled in apply().
export type DecorationMode = Decoration;

export abstract class ObserverBase {
  protected app: App;
  protected plugin: Plugin;
  protected containers = new Set<HTMLElement>();
  private observers = new WeakMap<HTMLElement, MutationObserver>();
  protected rules: Rule[] = [];
  protected metadata = new Map<string, TagMeta>();
  protected overrides: Record<string, TagOverride> = {};
  protected previewMode = false;
  protected enabled = true;
  private rafQueued = false;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  /** Discover containers and wire any reattachment triggers. */
  abstract init(): void;

  /**
   * (Re)discover host panes and (re)observe their containers. Called on init,
   * on host layout changes, and after a vault rescan so newly opened panes get
   * decorated. Idempotent via observeContainer's dedupe.
   */
  abstract attachAll(): void;

  setRules(rules: Rule[]): void {
    this.rules = rules;
    this.scheduleApply();
  }

  setMetadata(metadata: Map<string, TagMeta>): void {
    this.metadata = metadata;
    this.scheduleApply();
  }

  setOverrides(overrides: Record<string, TagOverride>): void {
    this.overrides = overrides;
    this.scheduleApply();
  }

  setPreviewMode(previewMode: boolean): void {
    this.previewMode = previewMode;
    this.scheduleApply();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearAll();
    else this.scheduleApply();
  }

  /**
   * MutationObserver init for this surface. childList + subtree catches rows
   * mounting/unmounting; characterData catches virtualized panes recycling a
   * row by mutating its text in place (without it a recycled row keeps the
   * prior tag's decoration). apply() only touches classes/attributes, never
   * text or children, so the default set cannot self-trigger a loop. Surfaces
   * whose host REWRITES class attributes in place (React reconciliation in
   * Notebook Navigator) override this to watch class mutations too.
   */
  protected observerInit(): MutationObserverInit {
    return { childList: true, subtree: true, characterData: true };
  }

  /**
   * Start observing a container, decorate it once, and register cleanup.
   * Idempotent: observing the same container twice is a no-op.
   */
  protected observeContainer(containerEl: HTMLElement): void {
    if (this.observers.has(containerEl)) return;
    const obs = new MutationObserver(() => this.scheduleApply());
    obs.observe(containerEl, this.observerInit());
    this.observers.set(containerEl, obs);
    this.containers.add(containerEl);
    this.plugin.register(() => {
      obs.disconnect();
      this.containers.delete(containerEl);
    });
    this.apply(containerEl);
  }

  /** Coalesce repeated apply requests into a single animation frame. */
  protected scheduleApply(): void {
    if (this.rafQueued) return;
    this.rafQueued = true;
    window.requestAnimationFrame(() => {
      this.rafQueued = false;
      for (const container of this.containers) {
        // A closed leaf/view detaches its container, but nothing else removes
        // it from the registry until plugin unload; without eviction every
        // pass re-walks the dead subtree and the observer pins it in memory
        // for the whole session (DA-10).
        if (!container.isConnected) {
          this.evictContainer(container);
          continue;
        }
        this.apply(container);
      }
    });
  }

  /**
   * Stop observing a detached container and forget it. The observers entry must
   * be deleted too: observeContainer dedupes on it, so a stale entry would
   * block re-observing the same element if the host re-attaches it later
   * (attachAll re-discovers returning panes on layout events).
   */
  private evictContainer(containerEl: HTMLElement): void {
    this.observers.get(containerEl)?.disconnect();
    this.observers.delete(containerEl);
    this.containers.delete(containerEl);
  }

  protected apply(root: HTMLElement): void {
    if (!this.enabled) {
      this.clearWithin(root);
      this.afterApply(root);
      return;
    }
    for (const { el, tag } of this.findRows(root)) {
      if (!tag) continue;
      const normalized = tag.startsWith('#') ? tag.slice(1) : tag;
      const meta = this.metadata.get(normalized);
      const { effective } = this.resolveRow(normalized, meta);
      // resolveDecoration is the single hidden/flagged/marked decision: null when
      // shown (no match, or an always-show override); 'marked' for a flag rule in
      // either mode; 'hidden' / 'flagged' for a hide rule (flagged in preview).
      const deco = RuleEngine.resolveDecoration(effective, this.previewMode);
      if (deco) {
        // A non-null decoration guarantees effective is non-null; the assertion
        // lets TypeScript know without duplicating the null check inline.
        this.applyDecoration(el, effective!.ruleId, deco);
      } else {
        this.clearDecoration(el);
      }
    }
    this.afterApply(root);
  }

  /**
   * Post-pass hook, called after every apply pass over a container - including
   * passes taken while disabled (which clear instead of decorate). Surfaces
   * that must reconcile host-owned state with the decorations they just
   * changed override this; the core tag pane uses it for its virtualizer
   * coherence sweep. Default: no-op.
   */
  protected afterApply(_root: HTMLElement): void {}

  /**
   * Resolve a single row's visibility. The default delegates to the shared
   * RuleEngine (overrides + rules + preview semantics live in the base apply
   * loop). Subclasses override ONLY to widen the lookup - e.g. the Notebook
   * Navigator observer also inherits an ancestor's hide for a descendant tag,
   * because NN renders nested tags as flat sibling rows. Overrides must still
   * call RuleEngine.resolveVisibility rather than reimplement it.
   */
  protected resolveRow(
    tag: string,
    meta: TagMeta | undefined,
  ): RuleAttribution {
    return RuleEngine.resolveVisibility(tag, meta, this.rules, this.overrides);
  }

  protected clearWithin(root: HTMLElement): void {
    for (const el of this.findDecorated(root)) this.clearDecoration(el);
  }

  clearAll(): void {
    for (const container of this.containers) this.clearWithin(container);
  }

  unload(): void {
    this.clearAll();
    this.containers.clear();
  }

  // --- Surface-specific hooks, implemented by each subclass ---

  protected abstract findRows(root: HTMLElement): ObservedRow[];
  protected abstract applyDecoration(
    el: HTMLElement,
    ruleId: string,
    mode: DecorationMode,
  ): void;
  protected abstract clearDecoration(el: HTMLElement): void;
  protected abstract findDecorated(root: HTMLElement): HTMLElement[];
}
