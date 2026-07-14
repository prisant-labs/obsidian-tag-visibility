/**
 * Contextual bulk-action bar (Phase 3B-1, Step 3).
 *
 * Mirrors the Advanced Tables toolbar pattern: invisible when nothing is
 * selected, appearing only once the model holds a selection. Buttons route
 * through TagActions.applyBulk (Hide / Unhide / Mark reviewed).
 *
 * NOTE: There is no Flag bulk action. "flagged" is a derived display state of
 * Preview mode, not a per-tag pin you can bulk-apply, and the override store
 * (D-015) only holds 'show' | 'hide'. So this bar omits Flag by design; if a
 * flag override is ever added to the model/actions (see BulkAction), add the
 * button here.
 *
 * There is no Tag Wrangler button (DA-26): renaming is a one-tag-at-a-time modal
 * flow, so it lives on the row menu, not here. The button that used to sit here
 * fired a Tag Wrangler command that does not exist.
 */
import { setIcon } from 'obsidian';
import { TagListModel } from '../tagList/tagListModel';
import { TagActions, BulkAction } from '../tagList/tagActions';
import { TagListDiagnosticsHost } from './tagTableHost';

export class BulkBar {
  private root: HTMLElement;
  private countEl: HTMLElement;
  // Stored click handlers so destroy() can remove them.
  private readonly clickHandlers: Array<{ el: HTMLElement; fn: EventListener }> = [];

  constructor(
    parent: HTMLElement,
    private model: TagListModel,
    private actions: TagActions,
    private host: TagListDiagnosticsHost,
  ) {
    // No flex spacer: the bar wraps its buttons in a narrow pane (item 6), and a
    // growing spacer would force awkward line breaks. The count just leads.
    this.root = parent.createDiv({ cls: 'tct-bulk-bar' });
    this.countEl = this.root.createSpan({ cls: 'tct-bulk-count' });

    this.addButton('Hide', 'eye-off', () => this.runBulk('hide'));
    this.addButton('Unhide', 'eye', () => this.runBulk('unhide'));
    this.addButton('Mark reviewed', 'check', () => this.runBulk('mark-reviewed'));

    // No Tag Wrangler button (DA-26). Tag Wrangler renames through a modal
    // dialog, one tag at a time, so a bulk hand-off would stack N modals. It is
    // not a coherent bulk action and never was: the button that used to sit here
    // fired a Tag Wrangler command that does not exist, and lit up as if it had
    // worked. Renaming lives on the row menu, where it applies to one tag.

    this.addButton('Clear', 'x', () => {
      this.model.clearSelection();
      this.host.requestRefresh();
    });

    this.update();
  }

  private addButton(
    label: string,
    icon: string,
    onClick: () => void | Promise<void>,
  ): HTMLButtonElement {
    const btn = this.root.createEl('button', { cls: 'tct-bulk-btn' });
    const ic = btn.createSpan({ cls: 'tct-bulk-btn-ic' });
    setIcon(ic, icon);
    btn.createSpan({ text: label });
    const fn: EventListener = () => void onClick();
    btn.addEventListener('click', fn);
    this.clickHandlers.push({ el: btn, fn });
    return btn;
  }

  private async runBulk(action: BulkAction): Promise<void> {
    const tags = [...this.model.selection];
    if (tags.length === 0) return;
    await this.actions.applyBulk(tags, action);
    // Selection is consumed; clear it so the bar collapses after the action.
    this.model.clearSelection();
    this.host.requestRefresh();
  }

  /** Reflect the current selection size and live plugin state; hide when empty. */
  update(): void {
    const count = this.model.selection.size;
    if (count === 0) {
      this.root.addClass('tc-hidden');
      return;
    }
    this.root.removeClass('tc-hidden');
    this.countEl.setText(`${count} selected`);
  }

  /** Remove all event listeners and detach the bar from the DOM. */
  destroy(): void {
    for (const { el, fn } of this.clickHandlers) {
      el.removeEventListener('click', fn);
    }
    this.clickHandlers.length = 0;
    this.root.remove();
  }
}
