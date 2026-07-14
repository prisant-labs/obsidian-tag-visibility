import { TagOverride } from '../../types';

export type BulkAction =
  | 'hide'
  | 'unhide'
  | 'mark-reviewed'
  | 'mark-unreviewed';

/**
 * The one method we call on Tag Wrangler, structurally typed. Runtime interop
 * only: we never import from Tag Wrangler, we duck-type what we need and
 * feature-detect it, the same posture as the Notebook Navigator integration.
 */
interface TagWranglerLike {
  rename(tagName: string, toName?: string): unknown;
}

/** Visibility verbs the action layer accepts. 'clear' removes any pin. */
export type VisibilityIntent = 'hide' | 'show' | 'clear';

export interface VisibilityResult {
  applied: number;
  deferred: number;
}

export interface TagActionsHost {
  isPluginEnabled(id: string): boolean;
  /**
   * The live plugin instance registered under `id`, or null. Runtime interop
   * only (no source coupling, no imports); callers must feature-detect whatever
   * they intend to call on it.
   */
  getPluginInstance(id: string): unknown;
  /**
   * Persist a per-tag visibility override (D-015): 'hide' / 'show' pins the tag,
   * null clears the pin. Keys carry no leading '#'. The store resolves these
   * ahead of rules; see SettingsManager.setOverride / RuleEngine.resolveVisibility.
   */
  setOverride(tag: string, value: TagOverride | null): void | Promise<void>;
  /** Persist a per-tag reviewed flag for many tags in one batched write. Keys carry no leading '#'. */
  setReviewedBulk(tags: string[], value: boolean): void | Promise<void>;
}

export class TagActions {
  constructor(private hostApi: TagActionsHost) {}

  tagWranglerInstalled(): boolean {
    return this.hostApi.isPluginEnabled('tag-wrangler');
  }

  /**
   * Hand ONE tag to Tag Wrangler's rename flow. Returns false if the hand-off
   * could not be made, so the caller can tell the user instead of pretending.
   *
   * DA-26. This previously called executeCommandById('tag-wrangler:rename-tag')
   * once per tag and never read the tags it was given. It could not have worked:
   * Tag Wrangler registers NO commands (verified against its source), so the id
   * did not exist; and executeCommandById takes no arguments, so there was no
   * channel to say WHICH tag even if it had.
   *
   * Tag Wrangler's plugin class exposes `rename(tagName, toName = tagName)`, and
   * calling it with one argument is exactly what its OWN context menu does
   * ("Rename #"+tagName -> this.rename(tagName)): it opens the rename dialog for
   * that tag. Tag names carry no leading '#', which matches how we key tags.
   *
   * Single-tag only, deliberately. Tag Wrangler renames through a modal dialog,
   * so a bulk hand-off would fire N stacked modals; the bulk button is gone.
   */
  renameWithTagWrangler(tag: string): boolean {
    if (!this.tagWranglerInstalled()) return false;
    const tw = this.hostApi.getPluginInstance('tag-wrangler') as TagWranglerLike | null;
    if (typeof tw?.rename !== 'function') return false;
    try {
      void tw.rename(tag);
      return true;
    } catch {
      // Tag Wrangler changed its API or threw. Degrade, never take the app down.
      return false;
    }
  }

  // Per-tag overrides are real now (D-015): hide/show pin the tag, clear removes
  // the pin. The store resolves overrides ahead of rules, so every tag applies.
  async setVisibility(tags: string[], to: VisibilityIntent): Promise<VisibilityResult> {
    const value: TagOverride | null = to === 'clear' ? null : to;
    for (const tag of tags) {
      await this.hostApi.setOverride(tag, value);
    }
    return { applied: tags.length, deferred: 0 };
  }

  async markReviewed(tags: string[], value: boolean): Promise<VisibilityResult> {
    await this.hostApi.setReviewedBulk(tags, value);
    return { applied: tags.length, deferred: 0 };
  }

  // No Tag Wrangler case: renaming is a one-tag-at-a-time modal flow, so there is
  // no coherent bulk hand-off (DA-26). Use renameWithTagWrangler from the row menu.
  async applyBulk(tags: string[], action: BulkAction): Promise<number | VisibilityResult> {
    switch (action) {
      case 'hide':
        return this.setVisibility(tags, 'hide');
      case 'unhide':
        return this.setVisibility(tags, 'show');
      case 'mark-reviewed':
        return this.markReviewed(tags, true);
      case 'mark-unreviewed':
        return this.markReviewed(tags, false);
    }
  }
}
