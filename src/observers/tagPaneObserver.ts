import { View, WorkspaceLeaf } from 'obsidian';
import { DecorationMode, ObservedRow, ObserverBase } from './observerBase';

const HIDDEN_CLASS = 'tag-curator-hidden';
const FLAG_CLASS = 'tag-curator-flagged';
const MARK_CLASS = 'tag-curator-marked';
const TAG_ATTR = 'data-tag-curator-rule';
const TAG_VIEW_TYPE = 'tag';

interface Filterable extends View {
  containerEl: HTMLElement;
}

/* -----------------------------------------------------------------
 * Obsidian tag-pane internals (undocumented; shapes verified live on
 * Obsidian 1.12.7). The coherence sweep below is the ONLY code that touches
 * them. Every access is feature-detected and wrapped, so if a future Obsidian
 * renames anything the sweep silently stops and the pane simply behaves as it
 * did before the sweep existed (rows hide, space reclaims on the pane's next
 * natural rebuild instead of immediately).
 * ----------------------------------------------------------------- */

interface TagPaneItemInfo {
  hidden: boolean;
  height: number;
}

interface TagPaneItem {
  selfEl?: HTMLElement;
  parent?: unknown;
  info?: TagPaneItemInfo;
}

interface TagPaneInfinityScroll {
  rootEl?: unknown;
  measure?: (parent: unknown, item: TagPaneItem) => void;
  updateVirtualDisplay?: () => void;
}

interface TagPaneViewInternals {
  tagDoms?: Record<string, TagPaneItem>;
  tree?: { infinityScroll?: TagPaneInfinityScroll };
}

/**
 * Decorates Obsidian's core tag pane (`.tag-pane-tag` rows). The shared
 * lifecycle lives in ObserverBase; this subclass supplies only the tag-pane
 * specifics: how to discover panes, how to read a row's tag, and how to mark a
 * row hidden or flagged.
 */
export class TagPaneObserver extends ObserverBase {
  // containerEl -> its Tags view, captured at attach time so the coherence
  // sweep can reach that pane's virtualizer internals.
  private views = new WeakMap<HTMLElement, Filterable & TagPaneViewInternals>();

  init(): void {
    this.app.workspace.onLayoutReady(() => this.attachAll());
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => this.attachAll()),
    );
  }

  attachAll(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TAG_VIEW_TYPE)) {
      this.attachLeaf(leaf);
    }
  }

  private attachLeaf(leaf: WorkspaceLeaf): void {
    const maybeDeferred = leaf as WorkspaceLeaf & {
      isDeferred?: boolean;
      loadIfDeferred?: () => void;
    };
    if (maybeDeferred.isDeferred) maybeDeferred.loadIfDeferred?.();
    const view = leaf.view as Filterable & TagPaneViewInternals;
    const containerEl = view?.containerEl;
    if (!containerEl) return;
    this.views.set(containerEl, view);
    this.observeContainer(containerEl);
  }

  setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    // Disabling strips decorations synchronously (kill switch / panic path);
    // re-measure the un-hidden rows right away so the pane's height model is
    // left coherent instead of waiting for a mutation-driven pass.
    if (!enabled) {
      for (const container of this.containers) this.sweepModel(container);
    }
  }

  unload(): void {
    this.clearAll();
    for (const container of this.containers) this.sweepModel(container);
    super.unload();
  }

  protected afterApply(root: HTMLElement): void {
    this.sweepModel(root);
  }

  /**
   * Model-DOM coherence sweep: reclaims (and returns) the space of rows this
   * observer hides, by keeping the tag pane's virtualizer height model in
   * agreement with the DOM.
   *
   * Why it exists: the pane's virtualizer lays rows out as
   * `info.hidden ? 0 : info.height || averageHeight`. A row we collapse via
   * CSS measures to height 0 but keeps `hidden=false` in the host's cache, so
   * the falsy 0 falls back to the AVERAGE row height - the row is invisible
   * yet its space stays reserved (a permanent gap), and the host's own
   * recompute passes can re-corrupt entries that were previously correct. The
   * repair is to run the host's OWN `measure()` on any row whose display
   * state disagrees with its cached `info.hidden` - in either direction, so
   * un-hiding restores height too - then refresh the virtual display once.
   *
   * Convergence: coherent rows are skipped (idempotent), and the host's
   * compute skips already-measured items, so repair passes reach a fixed
   * point instead of ping-ponging with the host. When the host DOES re-corrupt
   * (its recompute churns the DOM), the MutationObserver schedules another
   * apply pass and the sweep repairs again - self-healing by construction.
   */
  private sweepModel(root: HTMLElement): void {
    try {
      const view = this.views.get(root);
      const inf = view?.tree?.infinityScroll;
      const tagDoms = view?.tagDoms;
      if (!inf || !tagDoms) return;
      if (
        typeof inf.measure !== 'function' ||
        typeof inf.updateVirtualDisplay !== 'function'
      ) {
        return;
      }

      // Match rows to items by selfEl identity rather than tag text: it is
      // immune to key-format details (tagDoms keys carry a leading '#') and to
      // the parent-prefix span in nested-tag rows.
      const itemsBySelfEl = new Map<HTMLElement, TagPaneItem>();
      for (const key of Object.keys(tagDoms)) {
        const item = tagDoms[key];
        if (item?.selfEl) itemsBySelfEl.set(item.selfEl, item);
      }

      let repaired = 0;
      const rows = root.querySelectorAll<HTMLElement>('.tag-pane-tag');
      for (const row of Array.from(rows)) {
        const item = itemsBySelfEl.get(row);
        const info = item?.info;
        if (!item || !info) continue;
        const rowHidden = row.classList.contains(HIDDEN_CLASS);
        if (info.hidden === rowHidden) continue;
        try {
          inf.measure(item.parent ?? inf.rootEl, item);
          repaired++;
        } catch {
          // This row's repair failed; the pane settles it on its next natural
          // rebuild instead.
        }
      }
      if (repaired > 0) inf.updateVirtualDisplay();
    } catch {
      // Internals drifted (future Obsidian build): never let the sweep break
      // decoration. The pane behaves exactly as it did before the sweep.
    }
  }

  countHidden(): number {
    let count = 0;
    for (const container of this.containers) {
      count += container.querySelectorAll(`.${HIDDEN_CLASS}`).length;
    }
    return count;
  }

  countFlagged(): number {
    let count = 0;
    for (const container of this.containers) {
      count += container.querySelectorAll(`.${FLAG_CLASS}`).length;
    }
    return count;
  }

  ruleForElement(el: HTMLElement): string | null {
    return el.getAttribute(TAG_ATTR);
  }

  protected findRows(root: HTMLElement): ObservedRow[] {
    const rows = root.querySelectorAll<HTMLElement>('.tag-pane-tag');
    return Array.from(rows).map((row) => {
      // Read the tag from the text node ONLY, never the whole row: the row also
      // holds a count flair (.tag-pane-tag-count) whose digits would corrupt the
      // tag string (e.g. "D157FA" + "111" -> "D157FA111", which then fails the
      // hex pattern and leaks the tag). Current Obsidian renders the tag pane as
      // a generic tree-item (.tree-item-inner-text); older builds used
      // .tag-pane-tag-text. If neither is found the tag is empty and the row is
      // skipped - failing safe (shown), never corrupted.
      const textEl =
        row.querySelector('.tree-item-inner-text') ??
        row.querySelector('.tag-pane-tag-text');
      return { el: row, tag: (textEl?.textContent ?? '').trim() };
    });
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
    el.setAttribute(TAG_ATTR, ruleId);
  }

  protected clearDecoration(el: HTMLElement): void {
    el.classList.remove(HIDDEN_CLASS, FLAG_CLASS, MARK_CLASS);
    el.removeAttribute('aria-hidden');
    el.removeAttribute(TAG_ATTR);
  }

  protected findDecorated(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}, .${FLAG_CLASS}, .${MARK_CLASS}`),
    );
  }
}
